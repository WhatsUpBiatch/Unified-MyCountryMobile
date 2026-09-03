DROP TABLE IF EXISTS version;
CREATE TABLE version (
    table_name VARCHAR(128) DEFAULT '' NOT NULL,
    table_version INTEGER DEFAULT 0 NOT NULL
);

INSERT INTO "version" values ('address','6');
INSERT INTO "version" values ('trusted','6');

DROP TABLE IF EXISTS trusted;
CREATE TABLE trusted (
    id INTEGER PRIMARY KEY NOT NULL,
    src_ip VARCHAR(50) NOT NULL,
    proto VARCHAR(4) NOT NULL,
    from_pattern VARCHAR(64) DEFAULT NULL,
    ruri_pattern VARCHAR(64) DEFAULT NULL,
    tag VARCHAR(64),
    priority INTEGER DEFAULT 0 NOT NULL
);

DROP INDEX IF EXISTS trusted_peer_idx;
CREATE INDEX trusted_peer_idx ON trusted (src_ip);

DROP TABLE IF EXISTS address;
CREATE TABLE address (
    id INTEGER PRIMARY KEY NOT NULL,
    grp INTEGER DEFAULT 1 NOT NULL,
    ip_addr VARCHAR(50) NOT NULL,
    mask INTEGER DEFAULT 32 NOT NULL,
    port SMALLINT DEFAULT 0 NOT NULL,
    tag VARCHAR(64)
);

INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '5.161.88.93', '32', 'capanicus test server');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '65.21.232.143', '32', 'My IP');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '5.78.90.226', '32', 'My IP');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '147.224.202.138', '32', 'AI IP');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '46.19.210.19', '32', 'out.didww.com');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '46.19.209.14', '32', 'DIDWW New York');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '46.19.210.14', '32', 'DIDWW Frankfurt');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '46.19.212.14', '32', 'DIDWW Miami');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '46.19.213.14', '32', 'DIDWW Los Angeles');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '192.76.120.10', '32', 'Telnyx North Primary');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '64.16.250.10', '32', 'Telnyx North');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '192.76.120.31', '32', 'Telnyx Canada');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '64.16.250.13', '32', 'Telnyx Canada');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '64.16.250.13', '32', 'Telnyx Canada');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '54.229.21.111', '32', '46 Labs 1');
INSERT INTO address (grp, ip_addr, mask, tag) VALUES ('1', '38.147.130.91', '32', '46 Labs 2');
