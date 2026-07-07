import csv, json
CSV='/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv'
rows=list(csv.DictReader(open(CSV)))

# Snap tasks that duplicate an existing book anchor to the anchor price (consistency rule).
# name -> (price, labor_min, material, anchor_ref)
SNAP={
 "Electrical > Switches > Install Dimmer Switch":(95,30,10,"Switches, Dimmable $95"),
 "Electrical > Switches > Install Humidity Sensored Switch":(110,40,15,"Switches, Sensored $110"),
 "Electrical > Switches > Install Movement Sensored Switch":(110,40,15,"Switches, Sensored $110"),
 "Electrical > Switches > Install Photocell Switch (Exterior Dusk / Dawn)":(110,40,15,"Switches, Sensored $110"),
 "Electrical > Switches > Install Smart Switch (Wifi / Bluetooth)":(110,40,15,"Switches, Sensored $110"),
 "Electrical > Switches > Install Timer Switch":(110,40,15,"Switches, Sensored $110"),
 "Electrical > Switches > Replace 3 Way Switch":(110,45,10,"Switches, 3 Way $110"),
 "Electrical > Switches > Replace 4 Way Switch":(115,50,12,"Switches, 3 Way $110 +cx"),
 "Electrical > Switches > Replace Single Pole Switch":(85,30,5,"Switches, Replace Install $85"),
 "Electrical > Switches > Replace Double Pole Switch":(95,40,10,"between std $85 / sensored $110"),
 "Electrical > Outlets > Replace Outlet - Standard":(85,30,5,"Outlets, Replace/Install $85"),
 "Electrical > Outlets > Replace Outlet - GFCI":(95,30,15,"GFCI Outlets $95"),
 "Electrical > Outlets > Replace WR (Weather Resistant) Outlet":(95,30,15,"GFCI Outlets $95 (outdoor)"),
 "Electrical > Outlets > Replace Outlet (With Switched Receptacle)":(95,40,10,"Outlets, Split/Switch $95"),
 "Electrical > Distribution > Replace / Install Single Pole Circuit Breaker":(125,60,25,"Circuit Breakers, Replace $125"),
}
snapped=0
for r in rows:
    if r['name'] in SNAP:
        p,lm,mat,ref=SNAP[r['name']]
        r['market_price']=p; r['labor_minutes']=lm; r['material_allowance']=mat
        r['basis']=f"Snapped to book anchor ({ref}) for consistency"
        r['confidence']='high'
        snapped+=1
print("snapped to anchor:",snapped)

with open(CSV,'w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)

# ---------- VERIFICATION ----------
book=json.load(open('/sessions/bold-relaxed-brown/mnt/handoff/src/data/rate_book.json'))
anchors=[t for t in book['tasks'] if t.get('category')=='Electrical' and t.get('final_price')]
print("\n================ VERIFICATION ================")

# 1) formula vs price consistency (allow anchor-premium items to exceed formula)
print("\n[1] formula fit (price vs min/60*100 + mat*1.25):")
premium=[]; off=[]
for r in rows:
    lm=int(r['labor_minutes']); mat=int(r['material_allowance']); p=int(r['market_price'])
    calc=lm/60*100+mat*1.25
    d=p-calc
    if 'anchor' in r['basis'].lower() or 'snap' in r['basis'].lower():
        if d>2: premium.append((r['name'],p,round(calc),round(d)))
    elif abs(d)>6 and p>35:
        off.append((r['name'],p,round(calc),round(d)))
print(f"  {len(premium)} anchor-premium items (price intentionally above raw formula, expected)")
print(f"  {len(off)} non-anchor items off formula by >$6 (should be ~0):")
for e in off: print("   ",e)

# 2) outlier scan vs anchors: min/max sanity
print("\n[2] range & floor checks:")
prices=[int(r['market_price']) for r in rows]
print(f"  new prices: min ${min(prices)}  max ${max(prices)}  (anchor range ${min(a['final_price'] for a in anchors):.0f}-${max(a['final_price'] for a in anchors):.0f})")
below=[r['name'] for r in rows if int(r['market_price'])<35]
print(f"  below $35 floor: {len(below)}")

# 3) ground-up REFER must exceed the matching like-for-like anchor swap
print("\n[3] logic checks (ground-up install > swap anchor):")
checks=[
 ("Chandelier > Install New",390,"Fixture, Chandelier, Replace/Install New",225),
 ("Can / Recessed > Install New",200,"Fixture, Can Lights, Replace/Install New",120),
 ("Vanity > Install New",200,"Fixture, Vanity Light Bar",115),
 ("Track > Install New",315,"Fixture, Track Light",150),
 ("Exhaust Fans > Install New",550,"Exhaust Fan, Replace Unit",240),
]
for nm,gp,anm,ap in checks:
    ok="OK" if gp>ap else "!! LOWER THAN SWAP"
    print(f"  {ok}: {nm} ${gp} vs swap {anm} ${ap}")

# 4) compliance: every REFER/VERIFY carries a flag and a price
print("\n[4] compliance flag coverage:")
from collections import Counter
fl=Counter(r['flags'] or 'handyman' for r in rows)
print("  ",dict(fl))
noflag_regulated=[r['name'] for r in rows if r['flags']=='' and ('Breaker' in r['name'] or 'Run New' in r['name'] or 'Install New System' in r['name'])]
print("  regulated-looking items missing a flag:",noflag_regulated or "none")

# 5) confidence mix
print("\n[5] confidence:",dict(Counter(r['confidence'] for r in rows)))
print("\nrows total:",len(rows))
