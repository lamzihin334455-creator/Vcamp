"""One public metadata GET for the cover smoke. No cookies, credentials or model API."""
import json
import pathlib
import urllib.parse
import urllib.request

request = urllib.request.Request(
    'https://api.bilibili.com/x/web-interface/view?bvid=BV1pT4y1i72p',
    headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'})
with urllib.request.urlopen(request, timeout=20) as response:
    data = json.load(response)['data']
    image = urllib.parse.urlsplit(data['pic'])
    assert image.hostname in ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com']
    assert image.path.startswith('/bfs/') and not image.username and not image.port
    result = {'videoId': data['bvid'], 'title': data['title'],
              'coverUrl': 'https://' + image.hostname + image.path,
              'pages': [{key: page[key] for key in ['page', 'cid', 'part']} for page in data['pages']],
              'source': 'public Bilibili metadata API', 'http': response.status,
              'modelCalls': 0, 'keyRead': False}
output = pathlib.Path(__file__).resolve().parents[3] / '.tmp/opt-function/public-cover.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'http': result['http'], 'host': image.hostname, 'saved': True}))
