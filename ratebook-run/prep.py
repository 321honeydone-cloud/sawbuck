import json, re, os
from collections import defaultdict

book = json.load(open('/sessions/stoic-sharp-archimedes/mnt/handoff/src/data/rate_book.json'))
tasks = book['tasks']

# ---- Phase 1: deterministic unit re-tag ----
SF_PAT = re.compile(r'(flooring|carpet(?!\s*(cleaning))|tile.*(floor|wall|install)|laminate|vinyl plank|lvp|hardwood|drywall.*(install|hang|finish|texture)|popcorn|paint.*(wall|ceiling|interior|exterior|room)|sod|mulch|pressure wash|epoxy|underlayment|subfloor)', re.I)
LF_PAT = re.compile(r'(baseboard|crown|quarter round|shoe mold|trim(?!mer)|casing|chair rail|fenc(e|ing)|gutter|countertop edge|threshold|handrail|railing|weather ?strip|caulk.*(run|linear)|edging)', re.I)
HR_PAT = re.compile(r'(haul|hauling|general labor|labor.*hour|by the hour|excavator|rental|demo(lition)? labor|cleanup labor)', re.I)

def retag(t):
    name = (t.get('name') or '') + ' ' + (t.get('category') or '')
    if HR_PAT.search(name): return 'hour'
    if LF_PAT.search(name): return 'linear ft'
    if SF_PAT.search(name): return 'sq ft'
    return 'each'

changed = 0
for t in tasks:
    if t.get('name') == 'Trip Fee (per visit)': continue
    new = retag(t)
    t['suggested_unit'] = new
    if new != t.get('unit'): changed += 1
print('unit changes suggested:', changed)

# ---- Split stubs by trade, attach anchors ----
stubs = [t for t in tasks if not t.get('final_price')]
priced = [t for t in tasks if t.get('final_price')]
by_trade = defaultdict(list)
for t in stubs:
    by_trade[t.get('category','Other')].append(t)

# anchors: priced tasks in same/related category
priced_by_cat = defaultdict(list)
for t in priced:
    priced_by_cat[t.get('category','?')].append({'name':t['name'],'price':t['final_price'],'unit':t.get('unit')})

outdir='/sessions/stoic-sharp-archimedes/mnt/outputs/ratebook/trades'
os.makedirs(outdir, exist_ok=True)
manifest=[]
for cat, items in sorted(by_trade.items(), key=lambda kv:-len(kv[1])):
    slug = re.sub(r'[^a-z0-9]+','-',cat.lower()).strip('-')
    payload = {
        'trade': cat,
        'count': len(items),
        'anchors_same_book': priced_by_cat.get(cat, [])[:25],
        'tasks': [{'name':t['name'],'taxonomy_path':t.get('taxonomy_path',t['name']),'suggested_unit':t['suggested_unit']} for t in items]
    }
    with open(f'{outdir}/{slug}.json','w') as f: json.dump(payload,f,indent=1)
    manifest.append((cat, slug, len(items)))
    print(f'{len(items):4d}  {cat}')
print('total stubs:', sum(m[2] for m in manifest))

# unit retag report for whole book
import csv
with open('/sessions/stoic-sharp-archimedes/mnt/outputs/ratebook/unit_retag.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['category','name','old_unit','suggested_unit','priced'])
    for t in tasks:
        if t.get('suggested_unit') and t['suggested_unit']!=t.get('unit'):
            w.writerow([t.get('category'),t['name'],t.get('unit'),t['suggested_unit'],bool(t.get('final_price'))])
json.dump([{'trade':c,'slug':s,'count':n} for c,s,n in manifest], open('/sessions/stoic-sharp-archimedes/mnt/outputs/ratebook/manifest.json','w'), indent=1)
