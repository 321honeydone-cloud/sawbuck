import json, re, os, csv
from collections import defaultdict

BOOK='/sessions/bold-relaxed-brown/mnt/handoff/src/data/rate_book.json'
OUT='/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run'
book=json.load(open(BOOK)); tasks=book['tasks']

# ---------------- Phase 1: unit re-tag (base rules + fixes for false positives) ----------------
SF_PAT=re.compile(r'(floor(?!ing squeak)|carpet(?!.*(clean|shampoo|steam))|tile.*(floor|wall|backsplash|install|repair|shower|pool|counter)|laminate|vinyl|lvp|lvt|hardwood|drywall|popcorn|sod|mulch|pressure ?wash|epoxy|underlayment|subfloor|stucco|ceiling tile|drop ceiling)',re.I)
SF_PAT_PAINT=re.compile(r'paint',re.I)
LF_PAT=re.compile(r'(baseboard|crown|quarter round|shoe mold|\btrim\b|casing|chair rail|hand ?rail|\brail\b|gutter|counter ?top edge|threshold|transition strip|weather ?strip)',re.I)
HR_PAT=re.compile(r'(general labor|labor.*hour|by the hour|excavator|skid steer|scaffold|ladder rental|circular saw|nail gun|power tool)',re.I)

def base_unit(name, cat):
    s=(name or '')+' '+(cat or '')
    if HR_PAT.search(s): return 'hour'
    if LF_PAT.search(s): return 'linear ft'
    if SF_PAT.search(s): return 'sq ft'
    return 'each'

# targeted OVERRIDES that fix the false positives found in review
def unit_fix(name, cat, u):
    n=name.lower()
    # paint: per-room / whole-house / fees = each; per-sqft = sq ft; walls/ceilings generic = sq ft
    if 'paint' in n or cat=='Materials' and 'paint' in n:
        if re.search(r'per (bath|bed|room|closet|pantry|kitchen)|custom.*match|whole house|full (interior|exterior)|per hour|match fee',n):
            if 'per hour' in n: return 'hour'
            return 'each'
        if 'per square foot' in n or 'per sq' in n: return 'sq ft'
        if cat=='Materials': return 'each'          # paint sold per gallon
        return 'sq ft'                               # painting a surface = area
    # materials are sold per unit
    if cat=='Materials': return 'each'
    # lawn / tree = per service/job, not linear ft
    if re.search(r'lawn|mow|tree',n): return 'each'
    # fencing: linear runs = LF, but hardware/gates/latches/hinges/mounts = each
    if cat=='Fencing':
        if re.search(r'gate|latch|hinge|hardware|mount|self.clos|slat|post|component',n): return 'each'
        if re.search(r'build|picket|rail|privacy|chain link > (install|build)|masonry > build|seal|paint|sealer',n): return 'linear ft'
        return u
    # shower trim / beauty kit = each (not LF)
    if re.search(r'beauty kit|trim / beauty|tub/shower.*trim',n): return 'each'
    # transition strips = linear ft (were caught as sq ft under flooring)
    if 'transition strip' in n: return 'linear ft'
    # travel/hauling: per-load / per-trip = each; equipment stays hour
    if cat=='Travel / Hauling':
        if re.search(r'deliver|debris|disposal|dumpster|truck|van',n): return 'each'
    if cat=='Equipment Rental': return 'hour'
    # pressure washing = sq ft
    if 'pressure' in n and 'wash' in n: return 'sq ft'
    return u

for t in tasks:
    if t.get('name')=='Trip Fee (per visit)':
        t['suggested_unit']=t.get('unit'); continue
    u=base_unit(t.get('name'), t.get('category'))
    t['suggested_unit']=unit_fix(t.get('name'), t.get('category'), u)

# ---------------- Phase 2: anchor alias map ----------------
# stub canonical category -> list of priced categories to pull anchors from
ALIAS={
 'Interior Walls & Ceilings':['Interior Walls & Ceilings','Interior Wall & Ceiling Finishes &'],
 'Exterior Walls':['Exterior Walls','Exterior Walls Finishes'],
 'Landscaping':['Landscaping','Misc / Exterior'],
 'Travel / Hauling':['Travel / Hauling','Misc / Exterior'],
 'Carpentry':['Carpentry','Decks'],
 'Fencing':['Fencing','Decks'],
}
priced=[t for t in tasks if t.get('final_price')]
priced_by_cat=defaultdict(list)
for t in priced:
    priced_by_cat[t.get('category','?')].append(t)

def anchors_for(cat):
    srcs=ALIAS.get(cat,[cat])
    out=[]
    for s in srcs:
        for t in priced_by_cat.get(s,[]):
            out.append({'name':t['name'],'price':t['final_price'],'labor_minutes':t.get('labor_minutes'),
                        'material_allowance':t.get('material_allowance'),'unit':t.get('unit')})
    return out

# ---------------- Emit per-trade data for the 25 remaining trades (exclude Electrical, done) ----------------
stubs=[t for t in tasks if not t.get('final_price') and t.get('category')!='Electrical']
by_cat=defaultdict(list)
for t in stubs: by_cat[t.get('category','Other')].append(t)

os.makedirs(f'{OUT}/trades_v2',exist_ok=True)
manifest=[]
for cat,items in sorted(by_cat.items(),key=lambda kv:-len(kv[1])):
    slug=re.sub(r'[^a-z0-9]+','-',cat.lower()).strip('-')
    anc=anchors_for(cat)
    payload={'trade':cat,'slug':slug,'count':len(items),'anchor_count':len(anc),
             'anchors':anc[:40],
             'tasks':[{'name':t['name'],'taxonomy_path':'Labor > '+t['name'],'suggested_unit':t['suggested_unit']} for t in items]}
    json.dump(payload,open(f'{OUT}/trades_v2/{slug}.json','w'),indent=1)
    manifest.append((cat,slug,len(items),len(anc)))

# corrected unit retag report (whole book)
with open(f'{OUT}/unit_retag_v2.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['category','name','old_unit','suggested_unit','priced'])
    for t in tasks:
        if t.get('suggested_unit') and t['suggested_unit']!=t.get('unit'):
            w.writerow([t.get('category'),t['name'],t.get('unit'),t['suggested_unit'],bool(t.get('final_price'))])

print("=== per-trade data (trade | stubs | anchors attached) ===")
for c,s,n,a in manifest:
    flag='' if a>0 else '  <- no anchors (new trade, full research)'
    print(f"  {n:4d} stubs  {a:3d} anchors  {c}{flag}")
print("total remaining stubs:",sum(m[2] for m in manifest))
tot_changed=sum(1 for t in tasks if t.get('suggested_unit')!=t.get('unit') and t.get('name')!='Trip Fee (per visit)')
print("unit changes suggested (whole book):",tot_changed)
