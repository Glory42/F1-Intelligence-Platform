import html

_FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    "family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap\">"
)

_LOGO = (
    '<svg width="34" height="13" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    '<g fill="rgba(168,85,247,0.85)">'
    '<path d="M222.537,232.693h49.21l-0.469-12.424l-19.929-1.29c-0.423-0.062-0.782-0.359-0.938-0.782l-1.681-6.458'
    "c-0.141-0.399-0.078-0.86,0.156-1.212c0.25-0.351,0.657-0.563,1.095-0.563h18.951c-1.407-13.127-9.78-22.853-22.962-24.839"
    'c-18.741-2.815-33.228,10.602-30.93,26.708C215.978,218.386,219.261,228.714,222.537,232.693z"/>'
    '<path d="M65.417,237.509c-28.796,0-52.142,23.346-52.142,52.149c0,28.804,23.346,52.149,52.142,52.149'
    "c28.804,0,52.149-23.346,52.149-52.149C117.566,260.856,94.221,237.509,65.417,237.509z M65.417,317.156"
    "c-15.176,0-27.49-12.298-27.49-27.498c0-15.191,12.314-27.49,27.49-27.49c15.2,0,27.498,12.299,27.498,27.49"
    'C92.915,304.858,80.617,317.156,65.417,317.156z"/>'
    '<path d="M65.417,281.121c-4.707,0-8.522,3.831-8.522,8.538c0,4.715,3.815,8.538,8.522,8.538'
    'c4.715,0,8.546-3.823,8.546-8.538C73.963,284.952,70.132,281.121,65.417,281.121z"/>'
    '<path d="M393.738,229.965c-38.874-5.817-78.622-9.453-110.967-11.72c-2.291,10.148-9.75,19.264-19.186,19.264'
    "c-11.376,0-51.203,0-51.203,0v-22.751v-44.566c-61.97,6.756-101.288,39.296-124.165,64.268"
    "c21.658,8.976,36.942,30.336,36.942,55.198c0,5.583-0.79,10.977-2.228,16.122h214.946"
    'c-1.439-5.145-2.228-10.539-2.228-16.122C335.647,257.275,361.557,230.84,393.738,229.965z"/>'
    '<path d="M65.417,229.926c1.9,0,3.768,0.102,5.614,0.266l10.508-14.496v-33.173H0v83.439l8.741,4.902'
    'C16.646,247.111,39.061,229.926,65.417,229.926z"/>'
    '<path d="M470.281,286.813v-9.476l18.021-9.476c0,0,3.331-11.04,3.331-18.624c-21.219-7.005-49.57-11.102-75.738-15.684'
    "c22.862,8.397,39.217,30.375,39.217,56.105c0,5.583-0.79,10.977-2.236,16.122H512v-18.967H470.281z\"/>"
    '<path d="M395.38,237.509c-28.796,0-52.15,23.346-52.15,52.149c0,28.804,23.354,52.149,52.15,52.149'
    "c28.804,0,52.149-23.346,52.149-52.149C447.529,260.856,424.184,237.509,395.38,237.509z M395.38,317.156"
    "c-15.192,0-27.498-12.298-27.498-27.498c0-15.191,12.306-27.49,27.498-27.49c15.184,0,27.498,12.299,27.498,27.49"
    'C422.878,304.858,410.564,317.156,395.38,317.156z"/>'
    '<path d="M395.38,281.121c-4.715,0-8.538,3.831-8.538,8.538c0,4.715,3.823,8.538,8.538,8.538'
    'c4.715,0,8.53-3.823,8.53-8.538C403.91,284.952,400.095,281.121,395.38,281.121z"/>'
    "</g></svg>"
)

_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#000;color:#f7f7f7;min-height:100vh;-webkit-font-smoothing:antialiased;
  font-family:'Sora',system-ui,-apple-system,Segoe UI,sans-serif;
  background-image:linear-gradient(rgba(168,85,247,.02) 1px,transparent 1px),
    linear-gradient(90deg,rgba(168,85,247,.02) 1px,transparent 1px);background-size:44px 44px}
a{color:inherit;text-decoration:none}
.micro{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9px;letter-spacing:.18em;
  text-transform:uppercase;color:#8a8a8a}
.panel{border:1px solid rgba(255,255,255,.06);
  background:linear-gradient(160deg,rgba(13,13,13,.85),rgba(13,13,13,.55))}
.bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;height:48px;padding:0 20px;
  border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.72);
  backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%)}
.bar .sep{flex:1}
.dot{position:relative;display:inline-block;width:6px;height:6px;border-radius:9999px;background:#a855f7}
.dot.err{background:#ef4444}
.dot.warn{background:#f59e0b}
.dot.live::after{content:'';position:absolute;inset:0;border-radius:inherit;background:inherit;
  animation:ping 2s cubic-bezier(0,0,.2,1) infinite}
@keyframes ping{75%,100%{transform:scale(2.6);opacity:0}}
@media (prefers-reduced-motion:reduce){.dot.live::after{animation:none}}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(168,85,247,.25);border-radius:9999px}
::-webkit-scrollbar-thumb:hover{background:rgba(168,85,247,.45)}
"""

_LOGIN_CSS = """
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:360px;padding:32px 30px}
.card .brand{display:flex;align-items:center;gap:8px;margin-bottom:22px}
.card h1{font-size:19px;font-weight:700;letter-spacing:-.02em;margin-bottom:4px}
form{display:flex;flex-direction:column;gap:14px;margin-top:22px}
label span{display:block;margin-bottom:6px}
input{width:100%;background:#0a0a0a;border:1px solid rgba(255,255,255,.08);color:#f7f7f7;
  font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;padding:10px 12px;outline:none;
  transition:border-color .15s,box-shadow .15s}
input:focus{border-color:#a855f7;box-shadow:0 0 0 1px #a855f7}
button{margin-top:4px;width:100%;background:#a855f7;color:#fff;border:0;cursor:pointer;
  font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.18em;
  text-transform:uppercase;padding:12px;transition:background .15s}
button:hover{background:#c084fc}
.err-msg{color:#ef4444;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;margin-top:14px}
"""

_DASH_CSS = """
html,body{height:100%}
body{display:flex;flex-direction:column;overflow:hidden}
.bar{flex-shrink:0;position:relative}
.bar-link{position:absolute;left:50%;transform:translateX(-50%);
  display:inline-flex;align-items:center;gap:5px;color:#8a8a8a;transition:color .15s}
.bar-link:hover{color:#c084fc}
@media (max-width:560px){
  .bar-label{display:none}
  .bar-link{position:static;transform:none}
}
main{flex:1;min-height:0;display:flex;flex-direction:column;
  width:100%;max-width:940px;margin:0 auto;padding:32px max(20px,4vw) 24px}
.head{display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap;flex-shrink:0}
.head h1{font-size:22px;font-weight:700;letter-spacing:-.02em}
.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02)}
.pill .micro{color:#c7c7c7}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;
  margin-bottom:16px;flex-shrink:0}
.stat{padding:16px 18px}
.stat .micro{margin-bottom:8px}
.stat .val{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:14px;color:#f7f7f7;word-break:break-word}
.stat .val.err{color:#ef4444}
.logs{flex:1;min-height:0;display:flex;flex-direction:column;padding:20px 22px}
.logs .micro{margin-bottom:14px;flex-shrink:0}
.logs ul{list-style:none;flex:1;min-height:0;overflow-y:auto}
.logs li{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;line-height:1.5;color:#cfcfcf;
  padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.logs li:first-child{padding-top:0}
.logs li:last-child{border-bottom:0}
.logs .t{color:#7c5bbf;margin-right:8px}
"""

_TIME_SCRIPT = """<script>
document.querySelectorAll('[data-iso]').forEach(function(el){
  var iso=el.getAttribute('data-iso');if(!iso)return;
  var d=new Date(iso);if(isNaN(d.getTime()))return;
  var p=function(n){return String(n).padStart(2,'0')};
  var s=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+
    p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  el.textContent=el.dataset.wrap?'['+s+']':s;
});
</script>"""


def _page(title, body, *, head_extra="", css_extra=""):
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title>{_FONTS}{head_extra}"
        f"<style>{_CSS}{css_extra}</style></head><body>{body}</body></html>"
    )


def render_login(error=None):
    err = f'<p class="err-msg">{html.escape(error)}</p>' if error else ""
    body = f"""
<div class="wrap"><div class="card panel">
  <div class="brand">{_LOGO}<span class="micro">f1 predict</span></div>
  <h1>Data Engine</h1>
  <p class="micro">operator access</p>
  {err}
  <form method="post" action="/login">
    <label><span class="micro">username</span>
      <input name="username" autocomplete="username" autofocus required></label>
    <label><span class="micro">password</span>
      <input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Sign in</button>
  </form>
</div></div>
"""
    return _page("Data Engine: Sign in", body, css_extra=_LOGIN_CSS)


def _status_meta(status):
    s = (status or "").lower()
    if "error" in s:
        return "err", "error"
    if "starting" in s:
        return "warn", "starting"
    if "running" in s:
        return "live", "running"
    return "live", "idle"


def render_dashboard(state):
    dot_cls, label = _status_meta(state.get("status"))
    last_check = state.get("last_check") or ""
    last_error = state.get("last_error")
    err_val = html.escape(last_error) if last_error else "None"
    err_cls = " err" if last_error else ""
    rows = "".join(
        f'<li><span class="t" data-iso="{html.escape(entry["time"])}" data-wrap="1">'
        f'[{html.escape(entry["time"])}]</span>{html.escape(entry["msg"])}</li>'
        for entry in reversed(state.get("logs", []))
    ) or '<li style="color:#6a6a6a">No activity yet.</li>'

    body = f"""
<header class="bar"><span class="micro bar-label">f1 predict · data engine</span>
  <a class="micro bar-link" href="https://f1.gorkemkaryol.dev" target="_blank" rel="noopener noreferrer">open site ↗</a>
  <span class="sep"></span>
  <a class="micro" href="/logout">sign out</a>
</header>
<main>
  <div class="head">
    <h1>F1 Data Engine</h1>
    <span class="pill"><span class="dot {dot_cls}"></span><span class="micro">{label}</span></span>
  </div>
  <div class="grid">
    <div class="stat panel"><div class="micro">status</div>
      <div class="val">{html.escape(state.get("status") or "Unknown")}</div></div>
    <div class="stat panel"><div class="micro">last check</div>
      <div class="val" data-iso="{html.escape(last_check)}">{html.escape(last_check) or "Never"}</div></div>
    <div class="stat panel"><div class="micro">last error</div>
      <div class="val{err_cls}">{err_val}</div></div>
  </div>
  <div class="logs panel">
    <div class="micro">live activity · auto-refresh 30s</div>
    <ul>{rows}</ul>
  </div>
</main>
{_TIME_SCRIPT}
"""
    return _page(
        "F1 Data Engine: Status",
        body,
        head_extra='<meta http-equiv="refresh" content="30">',
        css_extra=_DASH_CSS,
    )
