#!/usr/bin/env python3
"""FreeSWITCH Directory Service - handles xml_curl directory lookups against MySQL."""

import os
import re
import json
import datetime
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs
import pymysql
import pymysql.cursors

LISTEN_ADDR = os.environ.get("HTTP_LISTEN_ADDR", "localhost:9001")
BASE_DOMAIN = os.environ.get("BASE_DOMAIN", "mycountrymobile.com")
MYSQL_DSN = os.environ.get("MYSQL_DSN", "")
DATABASE_PREFIX = os.environ.get("DATABASE_PREFIX", "mcm_")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info")

DIRECTORY_TPL = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="{domain}">
      <params>
        <param name="dial-string" value="{{presence_id=${{dialed_user}}@${{dialed_domain}}}}${{sofia_contact(*/${{dialed_user}}@${{dialed_domain}})}}"/>
      </params>
      <users>
        <user id="{user_id}">
          <params>
            <param name="password" value="{password}"/>
            <param name="vm-enabled" value="false"/>
            <param name="vm-password" value="1234"/>
            <param name="dial-string" value="{{presence_id=${{dialed_user}}@${{dialed_domain}}}}${{sofia_contact(*/${{dialed_user}}@${{dialed_domain}})}}"/>
          </params>
          <variables>
            <variable name="user_context" value="default"/>
            <variable name="domain_name" value="{domain}"/>
            <variable name="domain" value="{domain}"/>
            <variable name="caller_id_name" value="{caller_name}"/>
            <variable name="caller_id_number" value="{extension}"/>
            <variable name="accountcode" value="{extension}"/>
            <variable name="user_uuid" value="{user_uuid}"/>
            <variable name="company_uuid" value="{company_uuid}"/>
          </variables>
        </user>
      </users>
    </domain>
  </section>
</document>"""

NOT_FOUND_TPL = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>"""

EMPTY_DIR_TPL = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="{domain}">
      <params>
        <param name="dial-string" value="{{presence_id=${{dialed_user}}@${{dialed_domain}}}}${{sofia_contact(*/${{dialed_user}}@${{dialed_domain}})}}"/>
      </params>
      <users/>
    </domain>
  </section>
</document>"""


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

def get_db_connection():
    global DB_CONFIG
    if DB_CONFIG is None:
        DB_CONFIG = parse_dsn(MYSQL_DSN)

    kwargs = {
        "host": DB_CONFIG["host"],
        "port": DB_CONFIG["port"],
        "user": DB_CONFIG["user"],
        "password": DB_CONFIG["password"],
        "database": DB_CONFIG["database"],
        "connect_timeout": 5,
        "cursorclass": pymysql.cursors.DictCursor,
    }
    if DB_CONFIG["use_ssl"]:
        import ssl as _ssl
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        kwargs["ssl"] = ctx

    return pymysql.connect(**kwargs)


def lookup_sip_user(domain, username):
    username = re.sub(r'_(web|mobile|pstn)$', '', username)
    domain_part = domain.replace(f".{BASE_DOMAIN}", "")
    db_name = f"{DATABASE_PREFIX}{domain_part}"

    query = """
        SELECT u.extension, u.uuid, CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.caller_id, u.company_uuid, u.password
        FROM users u
        JOIN companies c ON c.uuid = u.company_uuid
        WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE'
        LIMIT 1
    """
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute(query, (db_name, username))
            row = cursor.fetchone()
        conn.close()
        if row:
            log("info", f"Found user: ext={row['extension']}, name={row['name']}, db_name={db_name}")
        else:
            log("warn", f"User not found: ext={username}, db_name={db_name}, domain={domain}")
        return row
    except Exception as e:
        log("error", f"MySQL query error: {e}")
        return None


def log(level, msg):
    if level == "debug" and LOG_LEVEL != "debug":
        return
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    print(json.dumps({"level": level, "@timestamp": ts, "msg": msg}), flush=True)


class DirectoryHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        params = {k: v[0] for k, v in parse_qs(body).items()}

        action = params.get("action", "")
        domain = params.get("domain", params.get("key_value", ""))
        user = params.get("user", params.get("sip_auth_username", ""))
        purpose = params.get("purpose", "")

        log("debug", f"action={action}, domain={domain}, user={user}, purpose={purpose}")

        response = NOT_FOUND_TPL

        if action in ("sip_auth", "user_call", "") and domain and user:
            row = lookup_sip_user(domain, user)
            if row:
                response = DIRECTORY_TPL.format(
                    domain=domain,
                    user_id=user,
                    password=row.get("password", "1234"),
                    caller_name=row.get("name", row["extension"]),
                    extension=row["extension"],
                    user_uuid=row["uuid"],
                    company_uuid=row["company_uuid"],
                )
        elif purpose in ("gateways", "network-list"):
            response = EMPTY_DIR_TPL.format(domain=domain or BASE_DOMAIN)

        body_bytes = response.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/xml")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

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
        conn = get_db_connection()
        conn.close()
        log("info", "MySQL connection verified OK")
    except Exception as e:
        log("error", f"MySQL connection failed: {e}")

    server = HTTPServer((host, port), DirectoryHandler)
    log("info", f"Directory service listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
