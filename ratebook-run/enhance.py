import csv, re
SRC='/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv'
rows=list(csv.DictReader(open(SRC)))

TYPO={'Diagonose':'Diagnose','Reporgram':'Reprogram','Repalce':'Replace'}
def display(name):
    leaf=name.replace('Electrical > ','')
    for a,b in TYPO.items(): leaf=leaf.replace(a,b)
    leaf=leaf.replace(' > ',' - ').strip().rstrip(',').strip()
    return leaf

def maxmult(r):
    fl=r['flags']; conf=r['confidence']; basis=r['basis'].lower()
    if fl in ('REFER','VERIFY'):        return 1.5   # subbed / variable scope
    if 'diagnos' in basis or 'troubleshoot' in basis: return 1.5
    if conf=='high':  return 1.15
    if conf=='med':   return 1.30
    return 1.5

# tasks that leave a real old unit behind = haul-off trigger for the engine's disposal line
HAUL = re.compile(r'(Exhaust Fan.*(Replace Unit|Install New)|Ceiling Fan.*Install New|Install New - Ground Up|Replace Detector)', re.I)

def r5(x): return int(round(x/5.0)*5)

fields=['category','name','display_name','taxonomy_path','unit',
        'price_expected','price_max_guarantee','material_allowance','labor_minutes',
        'haul_off','rate_year','basis','sources','confidence','flags']
out=[]
for r in rows:
    exp=int(r['market_price'])
    mx=max(exp+5, r5(exp*maxmult(r)))
    # haul-off: electrical is mostly none; only bulky old-unit removals qualify
    haul='yes' if HAUL.search(r['name']) and ('Exhaust' in r['name'] or 'Ceiling Fan > Install New' in r['name']) else 'no'
    out.append({
        'category':r['category'],'name':r['name'],'display_name':display(r['name']),
        'taxonomy_path':r['taxonomy_path'],'unit':r['unit'],
        'price_expected':exp,'price_max_guarantee':mx,
        'material_allowance':r['material_allowance'],'labor_minutes':r['labor_minutes'],
        'haul_off':haul,'rate_year':2026,
        'basis':r['basis'],'sources':r['sources'],'confidence':r['confidence'],'flags':r['flags']})

for path in ['/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv',
             '/sessions/bold-relaxed-brown/mnt/handoff/ratebook-run/electrical_review.csv']:
    with open(path,'w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(out)

# report
sp=[(r['display_name'],r['price_expected'],r['price_max_guarantee'],r['flags']) for r in out]
print("enhanced rows:",len(out))
haulyes=[r['display_name'] for r in out if r['haul_off']=='yes']
print("haul-off tasks:",len(haulyes),"->",haulyes)
print("\nsample two-build spread (expected -> max guarantee):")
import random
for r in sorted(out,key=lambda r:int(r['price_expected']))[::14]:
    print(f"  ${r['price_expected']:>4} -> ${r['price_max_guarantee']:>4}  [{r['flags'] or 'handyman'}]  {r['display_name']}")
print("\ncolumns:",", ".join(fields))
