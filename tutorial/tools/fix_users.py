"""重置演示账号：lily/demo123（审核员）、zhang/demo123（标注员），并关闭首登强制改密。"""
import hashlib, secrets, sqlite3
DB = '/home/robam/labelvla-docker/data/.platform/platform.db'
conn = sqlite3.connect(DB)
for u in ('zhang', 'lily'):
    salt = secrets.token_hex(16)
    digest = hashlib.sha256((salt + 'demo123').encode()).hexdigest()
    conn.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE username=?', (f'{salt}${digest}', u))
conn.commit()
print(conn.execute("select username, role, must_change_password from users where username in ('zhang','lily')").fetchall())
