#!/usr/bin/env python3
"""agentic_helper.py -- subcommands used by the generated agentic run.sh (stdlib only)."""
import glob, hashlib, json, os, re, shutil, sys

PH = re.compile(r"\{(wt|arm|rep|arm_dir|port|server_port)\}")


def subst(s, kv):
    return PH.sub(lambda m: kv.get(m.group(1), m.group(0)), s)


def kvs(args):
    return dict(a.split("=", 1) for a in args)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_sid(a):
    for line in open(a[0], encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if isinstance(d, dict) and d.get("session_id"):
            print(d["session_id"])
            return 0
    return 0


def cmd_models(a):
    try:
        ids = [m.get("id") for m in json.load(sys.stdin).get("data", [])]
    except Exception as e:
        print(f"unparsable /v1/models: {e}")
        return 2
    print("\n".join(str(i) for i in ids))
    return 0 if a[0] in ids else 1


def cmd_subst(a):
    sys.stdout.write(subst(a[0], kvs(a[1:])))
    return 0


def cmd_done(a):
    cfg = json.load(open(a[0]))["done_when"]
    path = os.path.join(a[1], cfg["file"])
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return 1
    m = re.compile(cfg["regex"], re.M).search(text)
    if not m:
        return 1
    ls = text.rfind("\n", 0, m.start()) + 1
    le = text.find("\n", m.end())
    print(text[ls:le if le >= 0 else len(text)])
    return 0


def cmd_prep(a):
    cfg, wt, arm_dir = json.load(open(a[0])), a[1], a[2]
    kv = dict(kvs(a[3:]), wt=wt, arm_dir=arm_dir)
    sums = []
    for it in cfg.get("install", []):
        dst = os.path.join(wt, it["dst"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.islink(dst):
            os.unlink(dst)
        shutil.copy2(it["src"], dst)
        sums.append(f"{sha256(it['src'])}  {it['src']}")
        print(f"install: {it['src']} -> {it['dst']}")
    with open(os.path.join(arm_dir, "installs.sha256"), "w") as fh:
        fh.write("".join(s + "\n" for s in sums))
    for it in cfg.get("rewrite", []):
        files = sorted(p for p in glob.glob(os.path.join(wt, it["glob"]), recursive=True)
                       if os.path.isfile(p) and not os.path.islink(p))
        if not files:
            print(f"rewrite: glob {it['glob']!r} matched no files in {wt}")
            return 3
        to = subst(it["to"], kv)
        for p in files:
            with open(p, encoding="utf-8", errors="surrogateescape", newline="") as fh:
                text = fh.read()
            n = text.count(it["from"])
            if n:
                with open(p, "w", encoding="utf-8", errors="surrogateescape", newline="") as fh:
                    fh.write(text.replace(it["from"], to))
            print(f"rewrite: {os.path.relpath(p, wt)}: {n} replacement(s)" + ("" if n else "  <-- WARNING none"))
    for it in cfg.get("symlinks", []):
        dst = os.path.join(wt, it["dst"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.lexists(dst):
            print(f"symlink: {it['dst']} already exists in the worktree")
            return 4
        os.symlink(it["src"], dst)
        print(f"symlink: {it['dst']} -> {it['src']}")
    return 0


def cmd_collect(a):
    cfg, wt, out = json.load(open(a[0])), a[1], a[2]
    for pat in cfg.get("collect", []):
        hits = sorted(glob.glob(os.path.join(wt, pat), recursive=True))
        if not hits:
            print(f"collect: {pat!r}: no match", file=sys.stderr)
        for p in hits:
            dst = os.path.join(out, os.path.relpath(p, wt))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.copytree(p, dst, symlinks=True, dirs_exist_ok=True)
            else:
                shutil.copy2(p, dst, follow_symlinks=False)
            print(f"collect: {os.path.relpath(p, wt)}")
    return 0



def _sw_match(obj, tool_re, input_re):
    """(name, input) of the first matching assistant tool_use block in a stream-json object, else None."""
    if not isinstance(obj, dict) or obj.get("type") != "assistant":
        return None
    msg = obj.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(content, list):
        return None
    for b in content:
        if isinstance(b, dict) and b.get("type") == "tool_use" and isinstance(b.get("name"), str):
            if tool_re.search(b["name"]) and input_re.search(json.dumps(b.get("input"), ensure_ascii=False)):
                return b["name"], b.get("input")
    return None


def _sw_signal(cpid, sig):
    for target in (-cpid, cpid):
        try:
            os.kill(target, sig)
            return True
        except OSError:
            pass
    return False


def cmd_watch(a):
    """watch CFG SESSION_FILE OUT_FILE CALL_IDX [CPID]: poll the growing stream-json file; at the first matching
    tool_use write OUT_FILE, then SIGINT the session's process group (escalating TERM, KILL) and exit 0."""
    import signal, time, datetime
    sw = json.load(open(a[0]))["stop_when"]
    tool_re, input_re = re.compile(sw["tool_regex"]), re.compile(sw["input_regex"])
    path, out, idx = a[1], a[2], a[3]
    cpid = int(a[4]) if len(a) > 4 and a[4] not in ("", "0") else 0
    pos, buf, lineno = 0, b"", 0
    while True:
        try:
            with open(path, "rb") as fh:
                fh.seek(pos)
                chunk = fh.read()
        except OSError:
            chunk = b""
        pos += len(chunk)
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            lineno += 1
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            hit = _sw_match(obj, tool_re, input_re)
            if hit:
                ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                txt = (f"call={idx}\nts={ts}\ntool={hit[0]}\nline={lineno}\n"
                       f"input={json.dumps(hit[1], ensure_ascii=False)}\n")
                with open(out + ".tmp", "w", encoding="utf-8") as fh:
                    fh.write(txt)
                os.replace(out + ".tmp", out)
                if cpid:
                    for sig, grace in ((signal.SIGINT, 30), (signal.SIGTERM, 30), (signal.SIGKILL, 0)):
                        if not _sw_signal(cpid, sig):
                            break
                        time.sleep(grace)    # the driver kills this watcher once the call has ended
                return 0
        time.sleep(1)


if __name__ == "__main__":
    fn = globals().get("cmd_" + sys.argv[1]) if len(sys.argv) > 1 else None
    if fn is None:
        sys.exit("usage: agentic_helper.py sid|models|subst|done|prep|collect ...")
    sys.exit(fn(sys.argv[2:]))
