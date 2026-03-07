import urllib.request
import json
import time

url = "http://localhost:8008/_matrix/client/v3/login"
headers = {'Content-Type': 'application/json'}
data = json.dumps({"type": "m.login.password", "identifier": {"type": "m.id.user", "user": "test_spam_1"}, "password": "pwd"}).encode('utf-8')

for i in range(100):
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req) as response:
            pass
        print(f"Success {i}")
    except urllib.error.HTTPError as e:
        print(f"Error {i}: {e.code} {e.read().decode('utf-8')}")
    time.sleep(0.01)
