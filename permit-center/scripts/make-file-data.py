# 가상인허가센터: data\*.json → data\*.js 사본 생성 (file:// 로 열 때 fetch 대신 <script> 로 읽기 위함)
# 사용: python permit-center\scripts\make-file-data.py   (sync.mjs 로 data\*.json 을 갱신한 뒤 다시 실행)
import json, pathlib

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
n = 0
for f in sorted(DATA.rglob("*.json")):
    key = "data/" + f.relative_to(DATA).as_posix()          # app.js loadJSON() 에 넘기는 경로와 같아야 함
    obj = json.loads(f.read_text(encoding="utf-8"))
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    js = "(window.__VPC_DATA=window.__VPC_DATA||{})[" + json.dumps(key) + "]=" + body + ";\n"
    f.with_suffix(".js").write_text(js, encoding="utf-8")
    n += 1
print(f"{n}개 .js 사본 생성: {DATA}")
