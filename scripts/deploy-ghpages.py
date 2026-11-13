"""Publish dist/ to the gh-pages branch through the GitHub API.

The machine's git push goes through a proxy that drops large or long-lived TLS
connections; api.github.com is reliable, so deployment does not depend on it.
"""
import base64, json, os, subprocess, sys, time

REPO = 'hkmpn9s6dh-commits/hackathon-2026-saddle-spoke'
API = f'https://api.github.com/repos/{REPO}'
TOKEN = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, check=True).stdout.strip()

def call(method, path, payload=None):
    cmd = ['curl', '-sS', '--max-time', '90', '--retry', '6', '--retry-all-errors',
           '--retry-delay', '3', '-X', method, API + path,
           '-H', f'Authorization: token {TOKEN}',
           '-H', 'Accept: application/vnd.github+json',
           '-H', 'Content-Type: application/json']
    data = None
    if payload is not None:
        cmd += ['-d', '@-']
        data = json.dumps(payload).encode()
    last = ''
    for attempt in range(4):
        out = subprocess.run(cmd, input=data, capture_output=True)
        if out.returncode == 0:
            text = out.stdout.decode()
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                last = text[:300]
        else:
            last = out.stderr.decode()[:200]
        time.sleep(4 * (attempt + 1))
    raise SystemExit(f'{method} {path} failed: {last}')

ref = call('GET', '/git/ref/heads/gh-pages')
head = ref.get('object', {}).get('sha')
base_tree = call('GET', f'/git/commits/{head}')['tree']['sha'] if head else None

items = []
for root, dirs, names in os.walk('dist'):
    dirs[:] = [d for d in dirs if d != '.git']
    for n in names:
        p = os.path.join(root, n)
        rel = os.path.relpath(p, 'dist').replace('\\', '/')
        content = base64.b64encode(open(p, 'rb').read()).decode()
        blob = call('POST', '/git/blobs', {'content': content, 'encoding': 'base64'})
        items.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        print('blob', rel)

payload = {'tree': items}
if base_tree:
    payload['base_tree'] = base_tree
tree = call('POST', '/git/trees', payload)
commit_payload = {'message': sys.argv[1] if len(sys.argv) > 1 else 'deploy', 'tree': tree['sha']}
if head:
    commit_payload['parents'] = [head]
commit = call('POST', '/git/commits', commit_payload)
if head:
    call('PATCH', '/git/refs/heads/gh-pages', {'sha': commit['sha'], 'force': True})
else:
    call('POST', '/git/refs', {'ref': 'refs/heads/gh-pages', 'sha': commit['sha']})
print('deployed', commit['sha'])
