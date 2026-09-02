#!/usr/bin/env python3
"""FreeSWITCH Dialplan Service - handles xml_curl dialplan lookups against MySQL."""

import os
import re
import json
import datetime
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs
import pymysql
import pymysql.cursors
from channel_limit import limit_actions
from queue_media import queue_audio_actions, queue_closed_route

LISTEN_ADDR = os.environ.get("HTTP_LISTEN_ADDR", "localhost:9000")
BASE_DOMAIN = os.environ.get("BASE_DOMAIN", "mycountrymobile.com")
MYSQL_DSN = os.environ.get("MYSQL_DSN", "")
DATABASE_PREFIX = os.environ.get("DATABASE_PREFIX", "mcm_")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info")
SERVER_IP = os.environ.get("SERVER_IP", "142.93.121.121")

NOT_FOUND_TPL = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>"""

def log(level, msg, **kwargs):
    if level == "debug" and LOG_LEVEL != "debug":
        return
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    entry = {"level": level, "@timestamp": ts, "msg": msg}
    entry.update(kwargs)
    print(json.dumps(entry), flush=True)


def parse_dsn(dsn):
    m = re.match(r'^(\w+):(.+)@tcp\(([^)]+)\)/([^?]+)(\?.*)?$', dsn)
    if not m:
        raise ValueError(f"Cannot parse DSN: {dsn}")
    host_port = m.group(3)
    host, port = host_port.rsplit(":", 1) if ":" in host_port else (host_port, "3306")
    params = m.group(5) or ""
    use_ssl = "tls" in params
    return {
        "user": m.group(1),
        "password": m.group(2),
        "host": host,
        "port": int(port),
        "database": m.group(4),
        "use_ssl": use_ssl,
    }


DB_CONFIG = None
_db_conn = None

def get_db():
    global DB_CONFIG, _db_conn
    if DB_CONFIG is None:
        DB_CONFIG = parse_dsn(MYSQL_DSN)
    if _db_conn is not None:
        try:
            _db_conn.ping(reconnect=True)
            return _db_conn
        except Exception:
            _db_conn = None
    kwargs = {
        "host": DB_CONFIG["host"],
        "port": DB_CONFIG["port"],
        "user": DB_CONFIG["user"],
        "password": DB_CONFIG["password"],
        "database": DB_CONFIG["database"],
        "connect_timeout": 5,
        "cursorclass": pymysql.cursors.DictCursor,
        # Without this the connection is pinned to one snapshot for its entire
        # life. This service holds a single connection open for weeks, so it
        # would answer every lookup from the database as it looked when the
        # process started: a number bought this morning is invisible, and a
        # calling restriction saved this afternoon refuses nothing. Nothing here
        # writes, so there is no transaction worth keeping open.
        "autocommit": True,
    }
    if DB_CONFIG["use_ssl"]:
        import ssl as _ssl
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        kwargs["ssl"] = ctx
    _db_conn = pymysql.connect(**kwargs)
    return _db_conn


def domain_to_dbname(domain):
    domain_part = domain.replace(f".{BASE_DOMAIN}", "")
    return f"{DATABASE_PREFIX}{domain_part}"


def strip_suffix(username):
    return re.sub(r'_(web|mobile|pstn)$', '', username)


def lookup_user(domain, username):
    username = strip_suffix(username)
    db_name = domain_to_dbname(domain)
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.uuid, u.extension, u.first_name, u.last_name,
                       u.caller_id, u.company_uuid, u.site_uuid,
                       CONCAT(u.first_name, ' ', u.last_name) AS name
                FROM users u
                JOIN companies c ON c.uuid = u.company_uuid
                WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE'
                LIMIT 1
            """, (db_name, username))
            row = cur.fetchone()
        return row
    except Exception as e:
        log("error", f"user lookup error: {e}")
        return None


def lookup_user_by_extension(domain, extension):
    db_name = domain_to_dbname(domain)
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.uuid, u.extension, u.first_name, u.last_name,
                       u.caller_id, u.company_uuid, u.site_uuid,
                       CONCAT(u.first_name, ' ', u.last_name) AS name
                FROM users u
                JOIN companies c ON c.uuid = u.company_uuid
                WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE'
                LIMIT 1
            """, (db_name, extension))
            row = cur.fetchone()
        return row
    except Exception as e:
        log("error", f"user by extension lookup error: {e}")
        return None


def lookup_did(did_number, company_uuid=None):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            did_clean = re.sub(r'^\+', '', did_number)
            cur.execute("""
                SELECT d.*, c.db_name
                FROM did_numbers d
                JOIN companies c ON c.uuid = d.company_uuid
                WHERE (d.did_number = %s OR d.did_number = %s) AND d.status = 'A'
                LIMIT 1
            """, (did_number, f"+{did_clean}"))
            row = cur.fetchone()
        return row
    except Exception as e:
        log("error", f"DID lookup error: {e}")
        return None


def get_caller_did(company_uuid):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT did_number FROM did_numbers
                WHERE company_uuid = %s AND status = 'A'
                ORDER BY id LIMIT 1
            """, (company_uuid,))
            row = cur.fetchone()
        return row["did_number"] if row else None
    except Exception as e:
        log("error", f"caller DID lookup error: {e}")
        return None


_cached_provider = None
_provider_cache_time = 0

def get_outbound_provider():
    global _cached_provider, _provider_cache_time
    import time
    now = time.time()
    if _cached_provider and (now - _provider_cache_time) < 300:
        return _cached_provider
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT uuid, name, host_ip_outbound, add_prefix, remove_prefix
                FROM providers
                WHERE status = 'A' AND type = 'CALL' AND host_ip_outbound IS NOT NULL
                ORDER BY providerID LIMIT 1
            """)
            row = cur.fetchone()
        if row:
            log("info", "outbound provider", name=row["name"], ip=row["host_ip_outbound"],
                add=row.get("add_prefix", ""), remove=row.get("remove_prefix", ""))
            _cached_provider = row
            _provider_cache_time = now
        return row
    except Exception as e:
        log("error", f"provider lookup error: {e}")
        return _cached_provider


def format_outbound_number(dest, provider):
    number = re.sub(r'^\+', '', dest)
    remove_prefix = provider.get("remove_prefix") or ""
    if remove_prefix and number.startswith(remove_prefix):
        number = number[len(remove_prefix):]
    add_prefix = provider.get("add_prefix") or ""
    return f"{add_prefix}{number}"


def build_internal_xml(context, extension_name, actions):
    action_xml = ""
    for act in actions:
        app = act.get("application", "")
        data = act.get("data", "")
        action_xml += f'      <action application="{app}" data="{data}" />\n'
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="{context}">
      <extension name="{extension_name}">
        <condition field="destination_number" expression="^(.*)$">
{action_xml}        </condition>
      </extension>
    </context>
  </section>
</document>"""



# --------------------------------------------------------------------------
# International calling control.
#
# Until now every number a person dialled was bridged to the carrier. If a
# password is stolen, the calls that follow are billed as real international
# minutes, and nothing here would have stopped them.
#
# The company's allowed countries are the ceiling; a person can be refused a
# country the company permits. Above both sits the rule that makes this safe
# to switch on: nothing configured means allow. No company has a list today,
# and reading "no list" as "allow nothing" would silence every outbound call.
# --------------------------------------------------------------------------

# Country data generated from the same phone-number library the web app uses,
# so the switch and the screens always agree about where a number is.
# CALLING_CODES maps a dialling code to every country that shares it; twelve
# codes are shared, so a number identifies a set, not always one country.
CALLING_CODES = {
    "211": ['SS'],
    "212": ['EH', 'MA'],
    "213": ['DZ'],
    "216": ['TN'],
    "218": ['LY'],
    "220": ['GM'],
    "221": ['SN'],
    "222": ['MR'],
    "223": ['ML'],
    "224": ['GN'],
    "225": ['CI'],
    "226": ['BF'],
    "227": ['NE'],
    "228": ['TG'],
    "229": ['BJ'],
    "230": ['MU'],
    "231": ['LR'],
    "232": ['SL'],
    "233": ['GH'],
    "234": ['NG'],
    "235": ['TD'],
    "236": ['CF'],
    "237": ['CM'],
    "238": ['CV'],
    "239": ['ST'],
    "240": ['GQ'],
    "241": ['GA'],
    "242": ['CG'],
    "243": ['CD'],
    "244": ['AO'],
    "245": ['GW'],
    "246": ['IO'],
    "247": ['AC'],
    "248": ['SC'],
    "249": ['SD'],
    "250": ['RW'],
    "251": ['ET'],
    "252": ['SO'],
    "253": ['DJ'],
    "254": ['KE'],
    "255": ['TZ'],
    "256": ['UG'],
    "257": ['BI'],
    "258": ['MZ'],
    "260": ['ZM'],
    "261": ['MG'],
    "262": ['RE', 'YT'],
    "263": ['ZW'],
    "264": ['NA'],
    "265": ['MW'],
    "266": ['LS'],
    "267": ['BW'],
    "268": ['SZ'],
    "269": ['KM'],
    "290": ['SH', 'TA'],
    "291": ['ER'],
    "297": ['AW'],
    "298": ['FO'],
    "299": ['GL'],
    "350": ['GI'],
    "351": ['PT'],
    "352": ['LU'],
    "353": ['IE'],
    "354": ['IS'],
    "355": ['AL'],
    "356": ['MT'],
    "357": ['CY'],
    "358": ['AX', 'FI'],
    "359": ['BG'],
    "370": ['LT'],
    "371": ['LV'],
    "372": ['EE'],
    "373": ['MD'],
    "374": ['AM'],
    "375": ['BY'],
    "376": ['AD'],
    "377": ['MC'],
    "378": ['SM'],
    "380": ['UA'],
    "381": ['RS'],
    "382": ['ME'],
    "383": ['XK'],
    "385": ['HR'],
    "386": ['SI'],
    "387": ['BA'],
    "389": ['MK'],
    "420": ['CZ'],
    "421": ['SK'],
    "423": ['LI'],
    "500": ['FK'],
    "501": ['BZ'],
    "502": ['GT'],
    "503": ['SV'],
    "504": ['HN'],
    "505": ['NI'],
    "506": ['CR'],
    "507": ['PA'],
    "508": ['PM'],
    "509": ['HT'],
    "590": ['BL', 'GP', 'MF'],
    "591": ['BO'],
    "592": ['GY'],
    "593": ['EC'],
    "594": ['GF'],
    "595": ['PY'],
    "596": ['MQ'],
    "597": ['SR'],
    "598": ['UY'],
    "599": ['BQ', 'CW'],
    "670": ['TL'],
    "672": ['NF'],
    "673": ['BN'],
    "674": ['NR'],
    "675": ['PG'],
    "676": ['TO'],
    "677": ['SB'],
    "678": ['VU'],
    "679": ['FJ'],
    "680": ['PW'],
    "681": ['WF'],
    "682": ['CK'],
    "683": ['NU'],
    "685": ['WS'],
    "686": ['KI'],
    "687": ['NC'],
    "688": ['TV'],
    "689": ['PF'],
    "690": ['TK'],
    "691": ['FM'],
    "692": ['MH'],
    "850": ['KP'],
    "852": ['HK'],
    "853": ['MO'],
    "855": ['KH'],
    "856": ['LA'],
    "880": ['BD'],
    "886": ['TW'],
    "960": ['MV'],
    "961": ['LB'],
    "962": ['JO'],
    "963": ['SY'],
    "964": ['IQ'],
    "965": ['KW'],
    "966": ['SA'],
    "967": ['YE'],
    "968": ['OM'],
    "970": ['PS'],
    "971": ['AE'],
    "972": ['IL'],
    "973": ['BH'],
    "974": ['QA'],
    "975": ['BT'],
    "976": ['MN'],
    "977": ['NP'],
    "992": ['TJ'],
    "993": ['TM'],
    "994": ['AZ'],
    "995": ['GE'],
    "996": ['KG'],
    "998": ['UZ'],
    "20": ['EG'],
    "27": ['ZA'],
    "30": ['GR'],
    "31": ['NL'],
    "32": ['BE'],
    "33": ['FR'],
    "34": ['ES'],
    "36": ['HU'],
    "39": ['IT', 'VA'],
    "40": ['RO'],
    "41": ['CH'],
    "43": ['AT'],
    "44": ['GB', 'GG', 'IM', 'JE'],
    "45": ['DK'],
    "46": ['SE'],
    "47": ['NO', 'SJ'],
    "48": ['PL'],
    "49": ['DE'],
    "51": ['PE'],
    "52": ['MX'],
    "53": ['CU'],
    "54": ['AR'],
    "55": ['BR'],
    "56": ['CL'],
    "57": ['CO'],
    "58": ['VE'],
    "60": ['MY'],
    "61": ['AU', 'CC', 'CX'],
    "62": ['ID'],
    "63": ['PH'],
    "64": ['NZ'],
    "65": ['SG'],
    "66": ['TH'],
    "81": ['JP'],
    "82": ['KR'],
    "84": ['VN'],
    "86": ['CN'],
    "90": ['TR'],
    "91": ['IN'],
    "92": ['PK'],
    "93": ['AF'],
    "94": ['LK'],
    "95": ['MM'],
    "98": ['IR'],
    "1": ['AG', 'AI', 'AS', 'BB', 'BM', 'BS', 'CA', 'DM', 'DO', 'GD', 'GU', 'JM', 'KN', 'KY', 'LC', 'MP', 'MS', 'PR', 'SX', 'TC', 'TT', 'US', 'VC', 'VG', 'VI'],
    "7": ['KZ', 'RU'],
}

# +1 covers the United States, Canada and much of the Caribbean on one code,
# and it is where stolen-password fraud concentrates, so it is resolved exactly
# by area code rather than guessed.
NANP_AREA = {
    "201": "US",
    "202": "US",
    "203": "US",
    "204": "CA",
    "205": "US",
    "206": "US",
    "207": "US",
    "208": "US",
    "209": "US",
    "210": "US",
    "212": "US",
    "213": "US",
    "214": "US",
    "215": "US",
    "216": "US",
    "217": "US",
    "218": "US",
    "219": "US",
    "220": "US",
    "223": "US",
    "224": "US",
    "225": "US",
    "226": "CA",
    "227": "US",
    "228": "US",
    "229": "US",
    "231": "US",
    "234": "US",
    "235": "US",
    "236": "CA",
    "239": "US",
    "240": "US",
    "242": "BS",
    "246": "BB",
    "248": "US",
    "249": "CA",
    "250": "CA",
    "251": "US",
    "252": "US",
    "253": "US",
    "254": "US",
    "256": "US",
    "257": "CA",
    "260": "US",
    "262": "US",
    "263": "CA",
    "264": "AI",
    "267": "US",
    "268": "AG",
    "269": "US",
    "270": "US",
    "272": "US",
    "274": "US",
    "276": "US",
    "279": "US",
    "281": "US",
    "283": "US",
    "284": "VG",
    "289": "CA",
    "301": "US",
    "302": "US",
    "303": "US",
    "304": "US",
    "305": "US",
    "306": "CA",
    "307": "US",
    "308": "US",
    "309": "US",
    "310": "US",
    "312": "US",
    "313": "US",
    "314": "US",
    "315": "US",
    "316": "US",
    "317": "US",
    "318": "US",
    "319": "US",
    "320": "US",
    "321": "US",
    "323": "US",
    "324": "US",
    "325": "US",
    "326": "US",
    "327": "US",
    "329": "US",
    "330": "US",
    "331": "US",
    "332": "US",
    "334": "US",
    "336": "US",
    "337": "US",
    "339": "US",
    "340": "VI",
    "341": "US",
    "343": "CA",
    "345": "KY",
    "346": "US",
    "347": "US",
    "350": "US",
    "351": "US",
    "352": "US",
    "353": "US",
    "354": "CA",
    "360": "US",
    "361": "US",
    "363": "US",
    "364": "US",
    "365": "CA",
    "367": "CA",
    "368": "CA",
    "369": "US",
    "380": "US",
    "382": "CA",
    "385": "US",
    "386": "US",
    "401": "US",
    "402": "US",
    "403": "CA",
    "404": "US",
    "405": "US",
    "406": "US",
    "407": "US",
    "408": "US",
    "409": "US",
    "410": "US",
    "412": "US",
    "413": "US",
    "414": "US",
    "415": "US",
    "416": "CA",
    "417": "US",
    "418": "CA",
    "419": "US",
    "423": "US",
    "424": "US",
    "425": "US",
    "428": "CA",
    "430": "US",
    "431": "CA",
    "432": "US",
    "434": "US",
    "435": "US",
    "437": "CA",
    "438": "CA",
    "440": "US",
    "441": "BM",
    "442": "US",
    "443": "US",
    "445": "US",
    "447": "US",
    "448": "US",
    "450": "CA",
    "458": "US",
    "463": "US",
    "464": "US",
    "468": "CA",
    "469": "US",
    "470": "US",
    "473": "GD",
    "474": "CA",
    "475": "US",
    "478": "US",
    "479": "US",
    "480": "US",
    "484": "US",
    "500": "US",
    "501": "US",
    "502": "US",
    "503": "US",
    "504": "US",
    "505": "US",
    "506": "CA",
    "507": "US",
    "508": "US",
    "509": "US",
    "510": "US",
    "512": "US",
    "513": "US",
    "514": "CA",
    "515": "US",
    "516": "US",
    "517": "US",
    "518": "US",
    "519": "CA",
    "520": "US",
    "521": "US",
    "522": "US",
    "525": "US",
    "526": "US",
    "527": "US",
    "528": "US",
    "529": "US",
    "530": "US",
    "531": "US",
    "532": "US",
    "533": "US",
    "534": "US",
    "539": "US",
    "540": "US",
    "541": "US",
    "544": "US",
    "548": "CA",
    "551": "US",
    "557": "US",
    "559": "US",
    "561": "US",
    "562": "US",
    "563": "US",
    "564": "US",
    "566": "US",
    "567": "US",
    "570": "US",
    "571": "US",
    "572": "US",
    "573": "US",
    "574": "US",
    "575": "US",
    "577": "US",
    "579": "CA",
    "580": "US",
    "581": "CA",
    "582": "US",
    "584": "CA",
    "585": "US",
    "586": "US",
    "587": "CA",
    "588": "US",
    "600": "CA",
    "601": "US",
    "602": "US",
    "603": "US",
    "604": "CA",
    "605": "US",
    "606": "US",
    "607": "US",
    "608": "US",
    "609": "US",
    "610": "US",
    "612": "US",
    "613": "CA",
    "614": "US",
    "615": "US",
    "616": "US",
    "617": "US",
    "618": "US",
    "619": "US",
    "620": "US",
    "622": "CA",
    "623": "US",
    "626": "US",
    "628": "US",
    "629": "US",
    "630": "US",
    "631": "US",
    "633": "CA",
    "636": "US",
    "639": "CA",
    "640": "US",
    "641": "US",
    "645": "US",
    "646": "US",
    "647": "CA",
    "649": "TC",
    "650": "US",
    "651": "US",
    "656": "US",
    "657": "US",
    "658": "JM",
    "659": "US",
    "660": "US",
    "661": "US",
    "662": "US",
    "664": "MS",
    "667": "US",
    "669": "US",
    "670": "MP",
    "671": "GU",
    "672": "CA",
    "678": "US",
    "680": "US",
    "681": "US",
    "682": "US",
    "683": "CA",
    "684": "AS",
    "686": "US",
    "689": "US",
    "701": "US",
    "702": "US",
    "703": "US",
    "704": "US",
    "705": "CA",
    "706": "US",
    "707": "US",
    "708": "US",
    "709": "CA",
    "712": "US",
    "713": "US",
    "714": "US",
    "715": "US",
    "716": "US",
    "717": "US",
    "718": "US",
    "719": "US",
    "720": "US",
    "721": "SX",
    "724": "US",
    "725": "US",
    "726": "US",
    "727": "US",
    "728": "US",
    "730": "US",
    "731": "US",
    "732": "US",
    "734": "US",
    "737": "US",
    "738": "US",
    "740": "US",
    "742": "CA",
    "743": "US",
    "747": "US",
    "748": "US",
    "753": "CA",
    "754": "US",
    "757": "US",
    "758": "LC",
    "760": "US",
    "762": "US",
    "763": "US",
    "765": "US",
    "767": "DM",
    "769": "US",
    "770": "US",
    "771": "US",
    "772": "US",
    "773": "US",
    "774": "US",
    "775": "US",
    "778": "CA",
    "779": "US",
    "780": "CA",
    "781": "US",
    "782": "CA",
    "784": "VC",
    "785": "US",
    "786": "US",
    "787": "PR",
    "800": "US",
    "801": "US",
    "802": "US",
    "803": "US",
    "804": "US",
    "805": "US",
    "806": "US",
    "807": "CA",
    "808": "US",
    "809": "DO",
    "810": "US",
    "812": "US",
    "813": "US",
    "814": "US",
    "815": "US",
    "816": "US",
    "817": "US",
    "818": "US",
    "819": "CA",
    "820": "US",
    "821": "US",
    "825": "CA",
    "826": "US",
    "828": "US",
    "829": "DO",
    "830": "US",
    "831": "US",
    "832": "US",
    "833": "US",
    "835": "US",
    "838": "US",
    "839": "US",
    "840": "US",
    "843": "US",
    "844": "US",
    "845": "US",
    "847": "US",
    "848": "US",
    "849": "DO",
    "850": "US",
    "854": "US",
    "855": "US",
    "856": "US",
    "857": "US",
    "858": "US",
    "859": "US",
    "860": "US",
    "862": "US",
    "863": "US",
    "864": "US",
    "865": "US",
    "866": "US",
    "867": "CA",
    "868": "TT",
    "869": "KN",
    "870": "US",
    "872": "US",
    "873": "CA",
    "876": "JM",
    "877": "US",
    "878": "US",
    "879": "CA",
    "888": "US",
    "900": "US",
    "901": "US",
    "902": "CA",
    "903": "US",
    "904": "US",
    "905": "CA",
    "906": "US",
    "907": "US",
    "908": "US",
    "909": "US",
    "910": "US",
    "912": "US",
    "913": "US",
    "914": "US",
    "915": "US",
    "916": "US",
    "917": "US",
    "918": "US",
    "919": "US",
    "920": "US",
    "925": "US",
    "928": "US",
    "929": "US",
    "930": "US",
    "931": "US",
    "934": "US",
    "936": "US",
    "937": "US",
    "938": "US",
    "939": "PR",
    "940": "US",
    "941": "US",
    "942": "CA",
    "943": "US",
    "945": "US",
    "947": "US",
    "948": "US",
    "949": "US",
    "951": "US",
    "952": "US",
    "954": "US",
    "956": "US",
    "959": "US",
    "970": "US",
    "971": "US",
    "972": "US",
    "973": "US",
    "975": "US",
    "978": "US",
    "979": "US",
    "980": "US",
    "983": "US",
    "984": "US",
    "985": "US",
    "986": "US",
    "989": "US",
}


# Anything this short is an extension, a service code or a short code - never an
# international call. Settled before the dialling codes, because a four-digit
# extension beginning with 1 otherwise reads as a North American number and the
# whole +1 zone comes back as its possible home.
INTERNAL_MAX_DIGITS = 4
SHORTEST_REAL_NUMBER = 7


def countries_of_number(dest):
    """Every country a dialled number could belong to.

    A set rather than one country, because twelve dialling codes are shared -
    +44 covers the United Kingdom, Guernsey, Jersey and the Isle of Man. Where
    the code is +1 the area code settles it exactly, since that zone spans the
    United States, Canada and the Caribbean and is where stolen-password fraud
    concentrates.

    An empty set means "cannot be placed", which is read everywhere here as
    "do not block".
    """
    number = re.sub(r"\D", "", str(dest or ""))
    if len(number) < SHORTEST_REAL_NUMBER:
        return set()

    best_code = ""
    for code in CALLING_CODES:
        if number.startswith(code) and len(code) > len(best_code):
            best_code = code
    if not best_code:
        return set()

    if best_code == "1":
        iso = NANP_AREA.get(number[1:4])
        return {iso} if iso else set(CALLING_CODES["1"])

    return set(CALLING_CODES[best_code])


def international_refusal(dest, from_number, rules):
    """A reason to refuse this call, or None to let it through.

    The order matters and is structural rather than remembered: the company's
    rule is the ceiling and is checked first, then the person's own permission
    narrows it further. A person can never be granted a country the company has
    ruled out.

    "Abroad" is judged against the caller's own number rather than a country
    field on the company record. That field is free text - a name in some rows,
    a code in others - and a rule that had to guess which would fail quietly and
    in the dangerous direction. The number somebody calls from is unambiguous.
    """
    restricted = rules.get("restricted") is True
    person_allowed = rules.get("person_allowed")

    # Nothing decided anywhere: behave exactly as the platform does today.
    if not restricted and person_allowed is None:
        return None

    number = re.sub(r"\D", "", str(dest or ""))
    if len(number) <= INTERNAL_MAX_DIGITS:
        return None  # an extension is never an international call

    candidates = countries_of_number(dest)
    if not candidates:
        # A number we cannot place is not evidence of abuse, and blocking it
        # would break valid dialling we simply do not recognise.
        return None

    home = countries_of_number(from_number)
    if home and (candidates & home):
        return None  # calling your own country is not calling abroad

    # --- the company's ceiling ---
    if restricted:
        allowed = rules.get("company_countries") or set()
        if not allowed:
            return "this company is not set up to call other countries"
        if not (candidates & allowed):
            return "this country is not on the company's allowed list"

    # --- then the person ---
    if person_allowed is False:
        return "this person is not allowed to call other countries"

    if person_allowed is True:
        narrowed = rules.get("person_countries") or set()
        if narrowed and not (candidates & narrowed):
            return "this country is not on this person's allowed list"

    return None


_calling_rules_cache = {}
_calling_rules_time = {}
CALLING_RULES_CACHE_SECONDS = 60

# The company's rule lives on a reserved settings record rather than a column,
# which is where the rest of the company-wide settings already live.
COMPANY_DEFAULT_TEMPLATE = "Company Default"
# Recording is OFF unless a company explicitly turns it on. Recording somebody
# who never asked to be recorded is the expensive mistake here, not missing a
# recording somebody wanted - so an absent or unreadable setting means off.
DEFAULT_RECORDING_MODE = "off"

# ALWAYS give lua an absolute path. A bare script name is resolved against
# /usr/share/freeswitch/scripts, which is empty on this box, and the failure is
# silent - "cannot open" in the log and the call carries on. Every script lives
# under FS_SCRIPTS. This has already been reintroduced once by a later edit, so
# if you are adding a lua action: use this constant, not a bare name.
FS_SCRIPTS = "/etc/freeswitch/scripts/"


def _country_set(raw):
    """A stored country list, whatever shape it arrives in.

    Messaging keeps these as objects carrying `country_code_iso2`; the newer
    screens write plain codes. Both are read, because failing to understand one
    of them would block calls that should go through.
    """
    if not isinstance(raw, list):
        return set()
    found = set()
    for entry in raw:
        if isinstance(entry, dict):
            iso = entry.get("country_code_iso2") or entry.get("iso2") or entry.get("code")
        else:
            iso = entry
        iso = str(iso or "").strip().upper()
        if iso:
            found.add(iso)
    return found


def _as_object(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value or {}


RING_SECONDS_DEFAULT = 30
RING_SECONDS_MIN = 5
RING_SECONDS_MAX = 120

_ring_cache = {}
_ring_cache_time = {}


def company_ring_seconds(db_name, company_uuid, fallback=RING_SECONDS_DEFAULT):
    """How long a phone should ring for this company, or the current default.

    Read from the same reserved settings record the calling rules come from.
    Anything missing, unreadable or out of range returns the number that was
    hardcoded before this existed - a phone ringing for the usual time is
    today's behaviour, while one ringing for no time at all would be a new
    fault introduced by a setting nobody checked.
    """
    key = "%s:%s" % (db_name, company_uuid)
    now = time.time()
    if key in _ring_cache and (now - _ring_cache_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _ring_cache[key]

    seconds = fallback
    try:
        if db_name:
            conn = get_db()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                    (COMPANY_DEFAULT_TEMPLATE,),
                )
                row = cur.fetchone() or {}
                settings = _as_object(row.get("settings"))
                block = _as_object(settings.get("company_ring_time"))
                value = int(block.get("seconds") or 0)
                if RING_SECONDS_MIN <= value <= RING_SECONDS_MAX:
                    seconds = value
    except Exception as e:
        log("error", "ring time lookup failed, using the default: %s" % e)
        return fallback

    _ring_cache[key] = seconds
    _ring_cache_time[key] = now
    return seconds


_number_count_cache = {}
_number_count_cache_time = {}


def company_number_count(company_uuid):
    """How many numbers this customer has, or None if it cannot be counted.

    None is not zero. A count that fails must leave the call unlimited rather
    than limited to nothing, so the failure path returns None and the caller
    then adds no limit at all. `status = 'A'` is the same test the DID lookup on
    this call path already uses, so "a number they own" means one thing here.
    """
    uuid = str(company_uuid or "").strip()
    if not uuid:
        return None

    now = time.time()
    if uuid in _number_count_cache and (now - _number_count_cache_time.get(uuid, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _number_count_cache[uuid]

    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM did_numbers WHERE company_uuid = %s AND status = 'A'",
                (uuid,),
            )
            row = cur.fetchone() or {}
            count = int(row.get("n") or 0)
    except Exception as e:
        log("error", "number count lookup failed, call left unlimited: %s" % e)
        return None

    _number_count_cache[uuid] = count
    _number_count_cache_time[uuid] = now
    return count


OPERATIONAL_HOURS_OPEN = "open"
OPERATIONAL_HOURS_CLOSED = "closed"
OPERATIONAL_HOURS_UNKNOWN = "unknown"

_HOURS_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

_hours_cache = {}
_hours_cache_time = {}


def _parse_hhmm(text):
    """"09:30" -> 570 minutes past midnight. None if it is not a time."""
    if not isinstance(text, str):
        return None
    parts = text.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


# A range longer than this is read as a typo rather than a year-long closure,
# and only its first day is taken. Nobody shuts a phone line for two years by
# intent, but a mistyped year turns one day into exactly that.
HOLIDAY_RANGE_LIMIT_DAYS = 366


def _one_date(value):
    """"2026-12-25" -> a date. None if it is not one.

    Ten characters minimum, so a time ("09:00") or an extension ("1001") is
    refused rather than half-parsed.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if len(text) < 10:
        return None
    try:
        return datetime.date.fromisoformat(text[:10])
    except ValueError:
        return None


def _holiday_dates(holidays):
    """Every day the company has declared closed.

    Returns two sets: the exact dates, and the (month, day) pairs of holidays
    marked as repeating every year, which are matched whatever the year is.

    A holiday is stored as a range - `from` and `to`, the same date twice for a
    single day - and that is the shape every screen in the portal writes, and
    always has. `value` is deliberately NOT read as a day: on a stored holiday
    that key holds the action's value, an extension number. Reading it as a date
    is what made every holiday miss.

    Anything unreadable is skipped. A holiday nobody can parse must not turn
    into a closed day by accident: the cost of a wrong "closed" is a real caller
    sent to voicemail on a working day, and nobody finds out until a customer
    complains.
    """
    exact = set()
    yearly = set()
    if not isinstance(holidays, list):
        return exact, yearly

    for entry in holidays:
        repeats = False
        if isinstance(entry, str):
            start = _one_date(entry)
            end = start
        elif isinstance(entry, dict):
            start = None
            for key in ("from", "date", "day", "start"):
                start = _one_date(entry.get(key))
                if start:
                    break
            end = None
            for key in ("to", "till", "end"):
                end = _one_date(entry.get(key))
                if end:
                    break
            repeats = bool(entry.get("repeats_yearly"))
        else:
            continue

        if start is None:
            continue
        if end is None or end < start:
            end = start
        span = (end - start).days
        if span > HOLIDAY_RANGE_LIMIT_DAYS:
            span = 0

        for offset in range(span + 1):
            day = start + datetime.timedelta(days=offset)
            if repeats:
                yearly.add((day.month, day.day))
            else:
                exact.add(day)

    return exact, yearly


def business_hours_state(operational_hours, now_utc=None):
    """Is the company open right now: "open", "closed", or "unknown".

    The third answer carries the weight. A company with no hours set, a
    timezone that will not resolve, or times that will not parse must not be
    guessed at - guessing "closed" sends a real caller to voicemail during
    business hours and nobody finds out until a customer complains. Every
    uncertain case answers "unknown", and the caller connects as it does today.
    """
    settings = _as_object(operational_hours)
    if not settings:
        return OPERATIONAL_HOURS_UNKNOWN

    if now_utc is None:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=datetime.timezone.utc)

    # The company clock, when there is one. A whole-day holiday only needs to
    # know today's date, so an unusable timezone falls back to UTC rather than
    # abandoning the check; the weekly times below are a different matter and
    # still refuse to run without a real one.
    tz_name = str((_as_object(_as_object(settings.get("regional")).get("timezone"))).get("value") or "").strip()
    tz = None
    if tz_name and ZoneInfo is not None:
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = None
    local = now_utc.astimezone(tz or datetime.timezone.utc)

    # First, before any schedule. A holiday is the owner saying "we are shut
    # that day", and that beats the weekly timetable, beats "open 24 hours",
    # and holds even for a company that never filled a timetable in.
    today = local.date()
    exact_holidays, yearly_holidays = _holiday_dates(settings.get("holidays"))
    if today in exact_holidays or (today.month, today.day) in yearly_holidays:
        return OPERATIONAL_HOURS_CLOSED

    kind = str(settings.get("type") or "").strip().lower()
    if not kind:
        return OPERATIONAL_HOURS_UNKNOWN
    if kind in ("24_hours", "24hours", "24"):
        return OPERATIONAL_HOURS_OPEN
    if kind != "weekly":
        return OPERATIONAL_HOURS_UNKNOWN

    if tz is None:
        return OPERATIONAL_HOURS_UNKNOWN

    day = _as_object(_as_object(settings.get("value")).get(_HOURS_DAYS[local.weekday()]))
    if not day:
        return OPERATIONAL_HOURS_UNKNOWN
    if not day.get("open"):
        return OPERATIONAL_HOURS_CLOSED

    start = _parse_hhmm(day.get("start"))
    end = _parse_hhmm(day.get("end"))
    if start is None or end is None or start == end:
        return OPERATIONAL_HOURS_UNKNOWN

    minutes = local.hour * 60 + local.minute
    if start < end:
        return OPERATIONAL_HOURS_OPEN if start <= minutes < end else OPERATIONAL_HOURS_CLOSED
    # end before start means the day runs past midnight, e.g. 22:00 to 06:00.
    return OPERATIONAL_HOURS_OPEN if (minutes >= start or minutes < end) else OPERATIONAL_HOURS_CLOSED


def company_operational_hours(db_name):
    """The company's opening hours, from the same reserved settings record the
    ring time and calling rules come from. Cached briefly, because this sits on
    the path of every inbound call. Any failure returns nothing, which the
    caller reads as "unknown" and therefore as today's behaviour."""
    if not db_name:
        return {}
    now = time.time()
    if db_name in _hours_cache and (now - _hours_cache_time.get(db_name, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _hours_cache[db_name]

    hours = {}
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            hours = dict(_as_object(settings.get("operational_hours")))
            # Company > Holidays keeps its list under its own key, separate from
            # the holidays typed into the opening-hours dialog. Both are the
            # company saying "we are shut on this day", so both are honoured and
            # neither overwrites the other.
            declared = settings.get("company_holidays")
            declared_items = declared.get("items") if isinstance(declared, dict) else declared
            if isinstance(declared_items, list) and declared_items:
                existing = hours.get("holidays")
                hours["holidays"] = (existing if isinstance(existing, list) else []) + declared_items
    except Exception as e:
        log("error", "opening hours lookup failed, treating as unknown: %s" % e)
        return {}

    _hours_cache[db_name] = hours
    _hours_cache_time[db_name] = now
    return hours


_recording_cache = {}
_recording_cache_time = {}


def company_recording_policy(db_name):
    """Whether this company records calls, and which direction.

    Returns one of "off", "all", "incoming", "outgoing".

    Anything missing, unreadable, or a shape this was not written for returns
    "off". That is the safe direction here and it is the opposite of the
    opening-hours rule: recording a call that should not have been recorded is a
    legal problem in most of the countries this platform sells into, while
    failing to record one is an inconvenience. So uncertainty means do not.
    """
    if not db_name:
        return "off"

    now = time.time()
    if db_name in _recording_cache and (now - _recording_cache_time.get(db_name, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _recording_cache[db_name]

    # Recording is on unless a company has explicitly turned it off.
    mode = DEFAULT_RECORDING_MODE
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            automatic = _as_object(_as_object(settings.get("recording")).get("automatic"))
            if "enabled" in automatic:
                if automatic.get("enabled") is True:
                    value = str(automatic.get("value") or "").strip().lower()
                    mode = value if value in ("all", "incoming", "outgoing") else DEFAULT_RECORDING_MODE
                else:
                    mode = "off"
    except Exception as e:
        log("error", "recording policy lookup failed, not recording: %s" % e)
        return "off"

    _recording_cache[db_name] = mode
    _recording_cache_time[db_name] = now
    return mode


def should_record(mode, direction):
    """direction is "inbound" or "outbound"."""
    if mode == "all":
        return True
    if mode == "incoming":
        return direction == "inbound"
    if mode == "outgoing":
        return direction == "outbound"
    return False


def company_on_demand_enabled(db_name):
    """Whether on-demand (agent-triggered) recording is enabled for the company."""
    if not db_name:
        return False
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            on_demand = _as_object(_as_object(settings.get("recording")).get("on_demand"))
            return on_demand.get("enabled") is True
    except Exception as e:
        log("error", "on-demand policy lookup failed: %s" % e)
        return False


def ondemand_actions(company_uuid, dtmf_leg="peer"):
    """Softphone Recording button sends *2 (start) / *3 (stop) as DTMF."""
    return [
        {"application": "set", "data": "recording_follow_transfer=true"},
        {"application": "set",
         "data": "api_hangup_hook=lua %supload_recording.lua ${uuid} %s" % (FS_SCRIPTS, company_uuid)},
        {"application": "bind_digit_action",
         "data": "ondrec,*2,exec:lua,%sondemand_record.lua start,%s,self" % (FS_SCRIPTS, dtmf_leg)},
        {"application": "bind_digit_action",
         "data": "ondrec,*3,exec:lua,%sondemand_record.lua stop,%s,self" % (FS_SCRIPTS, dtmf_leg)},
        {"application": "digit_action_set_realm", "data": "ondrec"},
    ]


def recording_actions(company_uuid, direction="inbound"):
    """Start the recorder, play the recording notice, and upload on hangup."""
    if direction == "outbound":
        notice = [
            {"application": "export",
             "data": "execute_on_answer=playback /etc/freeswitch/sounds/mcm/recording-announcement.wav"},
        ]
    else:
        notice = [
            {"application": "pre_answer", "data": ""},
            {"application": "playback", "data": "/etc/freeswitch/sounds/mcm/recording-announcement.wav"},
        ]
    return [
        {"application": "set", "data": "recording_follow_transfer=true"},
        {"application": "set",
         "data": "api_hangup_hook=lua %supload_recording.lua ${uuid} %s" % (FS_SCRIPTS, company_uuid)},
        {"application": "lua", "data": FS_SCRIPTS + "start_record.lua"},
    ] + notice


def get_calling_rules(db_name, company_uuid, user_uuid):
    """The company's rule and this person's own, read together and cached
    briefly, because this sits on the critical path of every outbound call.

    Deliberately NOT read from `companies.allow_country`. That column is written
    once at signup from the plan and is only ever changed by platform staff - it
    is the list of countries the plan entitles this company to choose from, not
    the choice an administrator made. Treating the entitlement as the rule would
    refuse calls nobody ever restricted.
    """
    key = "%s:%s" % (company_uuid, user_uuid)
    now = time.time()
    if key in _calling_rules_cache and (now - _calling_rules_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _calling_rules_cache[key]

    rules = {"restricted": False, "company_countries": set(),
             "person_allowed": None, "person_countries": set()}
    try:
        conn = get_db()
        with conn.cursor() as cur:
            # The company rule sits in that company's own database.
            if db_name:
                cur.execute(
                    "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                    (COMPANY_DEFAULT_TEMPLATE,),
                )
                row = cur.fetchone() or {}
                settings = _as_object(row.get("settings"))
                block = _as_object(
                    (settings.get("company_calling_permissions") or {}).get("international_calling")
                )
                # Only a literal true restricts. Absent, false or anything else
                # means no restriction, which is what every account has today.
                rules["restricted"] = block.get("restricted") is True
                rules["company_countries"] = _country_set(block.get("countries"))

            cur.execute("SELECT settings FROM users WHERE uuid = %s LIMIT 1", (user_uuid,))
            urow = cur.fetchone() or {}
            person = _as_object(_as_object(urow.get("settings")).get("international_calling"))
            allowed = person.get("allowed")
            # Absent, or anything that is not literally true/false, means
            # "follow the company" - there is one shape to read, not three.
            if allowed is True or allowed is False:
                rules["person_allowed"] = allowed
            rules["person_countries"] = _country_set(person.get("countries"))
    except Exception as e:
        # A lookup that fails must never stop calls going out. What this guards
        # against is theft over time, not one call, and a database hiccup
        # silencing a whole company's phones would be the worse failure.
        log("error", "calling rules lookup failed, allowing call: %s" % e)
        return {"restricted": False, "company_countries": set(),
                "person_allowed": None, "person_countries": set()}

    _calling_rules_cache[key] = rules
    _calling_rules_time[key] = now
    return rules


def build_user_dialplan(params, user, domain):
    dest = params.get("Hunt-Destination-Number", params.get("Caller-Destination-Number", ""))
    context = params.get("Caller-Context", params.get("Hunt-Context", "default"))
    caller_ext = user["extension"]
    caller_name = user.get("name", caller_ext)
    caller_id = user.get("caller_id") or get_caller_did(user["company_uuid"]) or caller_ext
    company_uuid = user["company_uuid"]
    # Read once per call rather than inside the list, which is built more than
    # once on some paths. The reader caches anyway, but a call that changes its
    # mind halfway through would be worse than a slightly stale one.
    outbound_recording_mode = company_recording_policy(domain_to_dbname(domain))
    user_uuid = user["uuid"]

    dest_clean = strip_suffix(dest)
    is_extension = re.match(r'^\d{3,5}$', dest_clean)

    if is_extension:
        dest_user = lookup_user_by_extension(domain, dest_clean)
        if dest_user:
            log("info", "internal call", src=caller_ext, dst=dest_clean, domain=domain)
            actions = [
                {"application": "set", "data": f"sip_h_X-Domain={domain}"},
                {"application": "set", "data": f"company_uuid={company_uuid}"},
                {"application": "set", "data": f"user_uuid={user_uuid}"},
                {"application": "set", "data": f"call_dialed=Y"},
                {"application": "set", "data": f"local_call_flag=Y"},
                {"application": "set", "data": f"effective_caller_id_name={caller_name}"},
                {"application": "set", "data": f"effective_caller_id_number={caller_ext}"},
                {"application": "set", "data": f"call_timeout={company_ring_seconds(domain_to_dbname(domain), company_uuid)}"},
                {"application": "set", "data": "continue_on_fail=true"},
                {"application": "bridge", "data": f"user/{dest_clean}_web@{domain},user/{dest_clean}@{domain}"},
            ]
            return build_internal_xml(context, f"user-{dest_clean}", actions)

    # A short internal number that matches nobody is a wrong number, not a call
    # somebody meant to pay for. Without this it falls through to the carrier,
    # which dials whatever those digits mean on the public network and bills it.
    if is_extension:
        log("warn", "unknown extension, refusing to dial out",
            src=caller_ext, dst=dest_clean, domain=domain)
        actions = [
            {"application": "set", "data": "call_blocked=unknown-extension"},
            {"application": "hangup", "data": "NO_ROUTE_DESTINATION"},
        ]
        return build_internal_xml(context, "unknown-ext-%s" % dest_clean, actions)

    # Is this person allowed to call this country? Checked before the carrier is
    # picked, so a refused call never reaches a provider.
    rules = get_calling_rules(domain_to_dbname(domain), company_uuid, user_uuid)
    refusal = international_refusal(dest, caller_id, rules)
    if refusal:
        log("warn", "outbound call refused", src=caller_ext, dst=dest,
            domain=domain, reason=refusal)
        actions = [
            {"application": "set", "data": "call_blocked=international"},
            # No prompt is played: this installation ships no sound files, and a
            # playback that cannot find its audio fails the call in a way that
            # looks like a fault rather than a decision. The rejection cause is
            # what the phone shows.
            {"application": "hangup", "data": "CALL_REJECTED"},
        ]
        return build_internal_xml(context, "blocked-%s" % dest, actions)

    provider = get_outbound_provider()
    if not provider:
        log("error", "no outbound provider found")
        return NOT_FOUND_TPL

    provider_ip = provider["host_ip_outbound"]
    formatted_dest = format_outbound_number(dest, provider)

    log("info", "outbound call", src=caller_ext, dst=dest, domain=domain,
        caller_id=caller_id, provider=provider["name"],
        formatted=formatted_dest, provider_ip=provider_ip)

    actions = [
        {"application": "export", "data": f"sip_h_X-Domain={domain}"},
        {"application": "set", "data": f"company_uuid={company_uuid}"},
        {"application": "set", "data": f"user_uuid={user_uuid}"},
        {"application": "set", "data": f"call_dialed=Y"},
        {"application": "set", "data": f"effective_caller_id_name={caller_name}"},
        {"application": "set", "data": f"effective_caller_id_number={caller_id}"},
        {"application": "export", "data": f"sip_h_X-Billable=Y"},
        {"application": "export", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
        {"application": "export", "data": f"sip_h_X-Outbound=Y"},
        {"application": "export", "data": f"sip_h_X-Outbound-Row-Owner={company_uuid}"},
        {"application": "set", "data": f"provider_uuid={provider['uuid']}"},
        {"application": "set", "data": "call_timeout=60"},
        {"application": "set", "data": "continue_on_fail=true"},
        {"application": "set", "data": "hangup_after_bridge=true"},
    ] + (recording_actions(company_uuid, "outbound")
         if should_record(outbound_recording_mode, "outbound") else []) + (ondemand_actions(company_uuid, "self") if company_on_demand_enabled(domain_to_dbname(domain)) else []) + [
        {"application": "bridge", "data": f"{{sip_h_X-Outbound=Y,absolute_codec_string='PCMU,PCMA',sip_route_uri=sip:127.0.0.1:5060,sip_from_uri=sip:{caller_id}@{SERVER_IP}}}sofia/internal/{formatted_dest}@{provider_ip}"},
    ]
    return build_internal_xml(context, f"outbound-{dest}", actions)


def build_inbound_dialplan(params, did_row, domain):
    dest = params.get("Caller-Destination-Number", params.get("Hunt-Destination-Number", ""))
    forward_actions = did_row.get("forward_call_actions")
    if isinstance(forward_actions, str):
        try:
            forward_actions = json.loads(forward_actions)
        except Exception:
            forward_actions = {}

    if not forward_actions:
        log("warn", "no forward_call_actions for DID", did=dest)
        return NOT_FOUND_TPL

    call_handling = forward_actions.get("call_handling", {})
    biz_hours = call_handling.get("business_hours", {})
    route_type = biz_hours.get("type", "")
    route_value = biz_hours.get("value", "")

    company_uuid = did_row.get("company_uuid", "")
    db_name = did_row.get("db_name", "")

    if not domain:
        if db_name and db_name.startswith(DATABASE_PREFIX):
            domain_part = db_name[len(DATABASE_PREFIX):]
            domain = f"{domain_part}.{BASE_DOMAIN}"

    log("info", "inbound call", did=dest, route_type=route_type, route_value=route_value, domain=domain)

    # How many calls this customer may have up at once: one channel per number
    # they have bought, plus one, so a single-number customer is not engaged to
    # their second caller of the day.
    #
    # The carrier cannot enforce this. DIDWW caps per number and per account and
    # has no idea our customers exist - every number we buy sits under one
    # account - so "these ten numbers share eleven channels" has to be counted
    # here, where the company that owns the dialled number is already known.
    #
    # Empty whenever the allowance cannot be worked out, which leaves the call
    # unlimited. A limit nobody can calculate must never become a limit of zero:
    # that would silently reject every call to that customer.
    channel_guard = limit_actions(company_uuid, company_number_count(company_uuid))
    if channel_guard:
        log("info", "channel limit applied", did=dest, company=company_uuid,
            limit=channel_guard[0]["data"].split()[3])

    # Outside opening hours, a number pointed at a desk phone goes to that
    # extension'''s voicemail rather than ringing an empty office. Only
    # EXTENSION is diverted: there is no stored closed-hours target for an IVR
    # or a queue, and inventing one would be guessing.
    #
    # Only a definite "closed" diverts. "unknown" - no hours set, an
    # unresolvable timezone, unparseable times - behaves exactly as before.
    if business_hours_state(company_operational_hours(db_name)) == OPERATIONAL_HOURS_CLOSED:
        # What the owner configured for out of hours, if anything.
        closed_block = _as_object(call_handling.get("closed_hours"))
        closed_type = str(closed_block.get("type") or "").strip().upper()
        closed_value = closed_block.get("value") or ""

        if closed_type and closed_value:
            log("info", "outside opening hours, using the closed-hours destination",
                did=dest, closed_type=closed_type)
            route_type = closed_type
            route_value = closed_value
            # The QUEUE branch reads the queue's display name off this block, so
            # it has to follow the route. Left pointing at the open-hours block,
            # an after-hours caller would land in a queue named for the daytime
            # one.
            biz_hours = closed_block

        elif route_type == "EXTENSION":
            # Nothing configured, and the number rings a person. Their voicemail
            # beats ringing an empty desk.
            log("info", "outside opening hours, no destination set, using voicemail",
                did=dest, extension=route_value)
            route_type = "VOICEMAIL"

        else:
            # A menu or a queue with no closed-hours destination. Nothing to
            # infer, so it rings through as it does today - said out loud rather
            # than failing quietly.
            log("info", "outside opening hours but no closed-hours destination for this route type",
                did=dest, route_type=route_type)

    # A queue may keep different hours from the company that owns it - support
    # open late while the office is dark. Its own hours were read by nothing at
    # all until now.
    #
    # Only a queue that is shut AND has an enabled answer of its own is diverted.
    # A shut queue with nothing configured rings on exactly as it does today,
    # because inventing a destination for it would be guessing, and a guess sends
    # the caller into silence.
    if route_type == "QUEUE":
        queue_closed_type, queue_closed_value = queue_closed_route(
            route_value,
            lambda hours: business_hours_state(hours) == OPERATIONAL_HOURS_CLOSED,
            log=log,
        )
        if queue_closed_type and queue_closed_value:
            log("info", "the queue itself is closed, using its own destination",
                did=dest, queue=route_value, closed_type=queue_closed_type)
            route_type, route_value = queue_closed_type, queue_closed_value

    if route_type == "EXTENSION":
        target_ext = route_value
        recording_mode = company_recording_policy(db_name)
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "set", "data": f"call_timeout={company_ring_seconds(db_name, company_uuid)}"},
            {"application": "set", "data": "continue_on_fail=true"},
            {"application": "set", "data": "hangup_after_bridge=true"},
        ] + (recording_actions(company_uuid) if should_record(recording_mode, "inbound") else []) + (ondemand_actions(company_uuid, "peer") if company_on_demand_enabled(db_name) else []) + [
            {"application": "bridge", "data": f"user/{target_ext}_web@{domain},user/{target_ext}@{domain}"},
        ]
        return build_internal_xml("public", f"inbound-{dest}", channel_guard + actions)

    if route_type == "VOICEMAIL":
        target_ext = route_value
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            # The recording script reads both of these off the channel. It files
            # the message under `accountcode`, so this is what separates one
            # company's voicemail from another's on disk.
            {"application": "set", "data": f"accountcode={company_uuid}"},
            {"application": "set", "data": f"vm_target_extension={target_ext}"},
            {"application": "answer", "data": ""},
            # Not the `voicemail` application: mod_voicemail is not loaded on
            # this system and cannot be. This is the path the old generator
            # used, and it needs no module and no sound files - the beep is a
            # generated tone.
            {"application": "lua", "data": FS_SCRIPTS + "save-voicemail.lua"},
        ]
        return build_internal_xml("public", f"voicemail-{dest}", channel_guard + actions)

    if route_type == "IVR":
        # route_value is the IVR's UUID, and the generated ivr.conf names each
        # menu by that same UUID, so it is passed straight through.
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "answer", "data": ""},
        ] + (recording_actions(company_uuid) if should_record(company_recording_policy(db_name), "inbound") else []) + [
            {"application": "ivr", "data": route_value},
        ]
        return build_internal_xml("public", f"ivr-{dest}", channel_guard + actions)

    if route_type == "QUEUE":
        # The queue's own record travels with the number, so its name and
        # extension come from there rather than another database read on the
        # call path. `label`/`name` is what a supervisor sees in reporting.
        queue_name = str(biz_hours.get("name") or biz_hours.get("label") or route_value)
        queue_exten = str(biz_hours.get("extension") or "")

        # The audio this queue's admin actually chose. Read from the queue record
        # rather than the number's routing, because that is where the greetings
        # are saved - and fetched to disk first, because the files live in object
        # storage and FreeSWITCH can only play what it can open.
        #
        # Both lists are empty whenever anything is missing or slow, and the
        # script then plays the stock hold music it always did. Silence on a
        # waiting caller is worse than the wrong music.
        queue_welcome, queue_audio = queue_audio_actions(route_value, company_uuid, log=log)

        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            # Read by callcenter-queue.lua, lines 27-31. The uuid is how the
            # agent lookup finds the queue; the rest is what it reports itself as.
            {"application": "set", "data": f"sip_h_X-Queue={route_value}"},
            {"application": "set", "data": f"cc_queue_name={queue_name}"},
            {"application": "set", "data": f"cc_queue_exten={queue_exten}"},
            {"application": "set", "data": f"sip_h_X-DID={dest}"},
            {"application": "set", "data": f"sip_h_X-ForwardType=QUEUE"},
            {"application": "set", "data": f"sip_h_X-ForwardValue={route_value}"},
            {"application": "set", "data": f"sip_h_X-ForwardName={queue_name}"},
            # Answered before the script runs: a caller waiting in a queue has to
            # hear hold music, and there is nothing to play down an unanswered
            # channel.
            {"application": "answer", "data": ""},
            # Ring strategy and queue timeout are left unset on purpose - see the
            # header. The script defaults them and the lookup service uses the
            # strategy stored on the queue, which is what an admin chose.
        ] + queue_audio + queue_welcome + (
            recording_actions(company_uuid) if should_record(company_recording_policy(db_name), "inbound") else []
        ) + [
            {"application": "lua", "data": FS_SCRIPTS + "callcenter-queue.lua"},
        ]
        return build_internal_xml("public", f"queue-{dest}", channel_guard + actions)

    if route_type == "PHONE":
        # Forward to an ordinary outside number. Everything about reaching the
        # carrier - prefixes, codecs, the route via Kamailio - is reused from the
        # outbound branch rather than restated, so there is one place to fix it.
        target = str(route_value or "").strip()
        if not target:
            log("warn", "number is forwarded to a phone but no number is set", did=dest)
            return NOT_FOUND_TPL

        provider = get_outbound_provider()
        if not provider:
            log("error", "cannot forward to a phone, no outbound provider", did=dest)
            return NOT_FOUND_TPL

        provider_ip = provider["host_ip_outbound"]
        formatted = format_outbound_number(target, provider)
        # The dialled number is one this company owns, so the carrier will accept
        # it as caller ID. Passing the original caller's number through is what
        # gets a forward rejected, and a rejected forward is a lost call.
        fwd_caller_id = re.sub(r"^\\+", "", str(dest or ""))

        log("info", "forwarding to an outside number", did=dest, to=target,
            formatted=formatted, provider=provider["name"])

        actions = [
            {"application": "export", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"effective_caller_id_number={fwd_caller_id}"},
            {"application": "export", "data": "sip_h_X-Billable=Y"},
            {"application": "export", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "export", "data": "sip_h_X-Outbound=Y"},
            {"application": "export", "data": f"sip_h_X-Outbound-Row-Owner={company_uuid}"},
            {"application": "set", "data": f"provider_uuid={provider['uuid']}"},
            {"application": "set", "data": f"call_timeout={company_ring_seconds(db_name, company_uuid)}"},
            {"application": "set", "data": "continue_on_fail=true"},
            {"application": "set", "data": "hangup_after_bridge=true"},
        ] + (recording_actions(company_uuid) if should_record(company_recording_policy(db_name), "inbound") else []) + [
            {"application": "bridge", "data": f"{{sip_h_X-Outbound=Y,absolute_codec_string='PCMU,PCMA',sip_route_uri=sip:127.0.0.1:5060,sip_from_uri=sip:{fwd_caller_id}@{SERVER_IP}}}sofia/internal/{formatted}@{provider_ip}"},
        ]
        return build_internal_xml("public", f"forward-{dest}", channel_guard + actions)

    if route_type == "HANGUP":
        # The owner chose not to take calls on this number. Refusing plainly is
        # not the same as breaking: NORMAL_CLEARING is what a phone reports as an
        # ended call rather than a fault.
        log("info", "number is set to hang up", did=dest)
        actions = [
            {"application": "set", "data": "call_blocked=owner-set-hangup"},
            {"application": "hangup", "data": "NORMAL_CLEARING"},
        ]
        return build_internal_xml("public", f"hangup-{dest}", channel_guard + actions)

    log("warn", "unhandled route type", route_type=route_type, did=dest)
    return NOT_FOUND_TPL


def extract_domain(params):
    for key in (
        "variable_sip_h_X-Domain",
        "variable_domain_name",
        "variable_domain",
        "variable_sip_auth_realm",
    ):
        val = params.get(key, "").strip()
        if val and BASE_DOMAIN in val:
            return val
    from_user = params.get("variable_sip_from_host", "")
    if from_user and BASE_DOMAIN in from_user:
        return from_user
    return ""


def extract_username(params):
    for key in ("variable_user_name", "Caller-Username", "variable_sip_from_user"):
        val = params.get(key, "").strip()
        if val:
            return val
    return ""


class DialplanHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        params = {k: v[0] for k, v in parse_qs(body).items()}

        log("debug", "dialplan request", path=self.path,
            params={k: v for k, v in sorted(params.items()) if not k.startswith("variable_rtp")})

        context = params.get("Caller-Context", params.get("variable_user_context", ""))
        dest = params.get("Hunt-Destination-Number",
                   params.get("Caller-Destination-Number", ""))
        username = extract_username(params)
        domain = extract_domain(params)
        cid_number = params.get("Hunt-Caller-ID-Number",
                        params.get("Caller-Caller-ID-Number", ""))

        log("info", "dialplan lookup", context=context, domain=domain,
            user=strip_suffix(username), dest=dest, cid=cid_number)

        response = NOT_FOUND_TPL

        if context in ("internal", "default") and domain and username:
            user = lookup_user(domain, username)
            if user:
                response = build_user_dialplan(params, user, domain)
            else:
                log("warn", "user not found for dialplan", user=username, domain=domain)
        elif context == "public" or (not context and dest):
            did_row = lookup_did(dest)
            if did_row:
                response = build_inbound_dialplan(params, did_row, domain)
            else:
                log("debug", "DID not found", dest=dest)

        body_bytes = response.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/xml")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_GET(self):
        if "/liveness" in self.path or "/health" in self.path:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OK")
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    if not MYSQL_DSN:
        log("fatal", "MYSQL_DSN environment variable is required")
        return

    host, port = LISTEN_ADDR.rsplit(":", 1)
    host = host if host and host != "localhost" else "127.0.0.1"
    port = int(port)

    try:
        conn = get_db()
        conn.ping()
        log("info", "MySQL connection verified OK")
    except Exception as e:
        log("error", f"MySQL connection failed: {e}")

    server = HTTPServer((host, port), DialplanHandler)
    log("info", f"Dialplan service listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
