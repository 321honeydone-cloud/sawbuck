#!/usr/bin/env python3
"""
Electrical pilot pricing. Realistic-minutes method:
  price = round5( labor_min/60 * 100  +  material_allowance * 1.25 )
Anchor-first: like-for-like tasks inherit the labor-min/material convention from
Manny's existing 55 priced electrical tasks. Web research (Homewyse Brevard zip,
Thumbtack/Fixr/Angi) fills genuinely-new archetypes and sets the REFER line.
Market_price column = external market cross-check (task-only, no trip fee).
"""
import json, csv, re, os

RATE = 100.0
MARKUP = 1.25

FLOOR = 35  # book's lowest anchor is ~$36 (a 20-min task); micro-tasks never sell below this
def price(lm, mat):
    raw = lm/60.0*RATE + mat*MARKUP
    return max(FLOOR, int(round(raw/5.0)*5))

# Ordered rules. First regex to match (on the taxonomy stub name) wins.
# fields: labor_min, material, refer(bool/str), basis, source, conf
# refer: False = handyman-legal; "REFER" = licensed/permit; "VERIFY" = gray, confirm
RULES = [
 # ---------- DISTRIBUTION: panel / circuits = REFER ----------
 (r'Distribution >.*AFCI Breaker',            (60,50,"REFER","Panel-interior AFCI breaker; licensed electrician + Brevard permit","research: empireelec AFCI $111-219 + AFCI part $35-65","med")),
 (r'Distribution >.*GFCI Breaker',            (60,50,"REFER","Panel-interior GFCI breaker; licensed electrician + permit","research: Homewyse GFCI breaker $307-373 all-in","med")),
 (r'Distribution >.*Double Pole Breaker',     (60,35,"REFER","240V panel-interior breaker; licensed electrician + permit","research: installed $200-400; anchor Circuit Breakers Replace $125","med")),
 (r'Distribution >.*Single Pole Circuit Breaker',(60,15,"REFER","Panel-interior breaker; licensed + permit. Held to book anchor for consistency","anchor: Circuit Breakers Replace $125","med")),
 (r'Distribution >.*Replace Fuse',            (30,10,"REFER","Fuse-box interior; opening panel is licensed work","anchor: Fuses Replace $60","med")),
 (r'Distribution >.*Run New Conduit',         (120,60,"REFER","New raceway = licensed electrical + permit. UNIT should be LF/lump not each","research: conduit $4-8/ft installed (nominal ~20ft run)","low")),
 (r'Distribution >.*Run New Leg',             (180,90,"REFER","New branch circuit from panel; licensed electrician + Brevard permit. Hard refer","research: usecalcpro new circuit $250-900 avg ~$650","med")),
 (r'Distribution >.*Reset Breaker',           (10,0,False,"Trivial maintenance, not electrical contracting; bill as min visit","estimate: quick task","high")),
 (r'Distribution >.*(Weatherproof Gang Box)', (60,20,"VERIFY","Box install; new wiring would make it licensed. Priced at book anchor","anchor: Outdoor Weatherproof Boxes Install $120","med")),
 (r'Distribution >.*Ceiling Fan Rated Box',   (60,20,"VERIFY","Fan-rated box install; new wiring would make it licensed. Book anchor","anchor: Ceiling Fan Rated Remodel Gang Boxes $120","med")),
 (r'Distribution >.*(Replace / Install Gang Box|Install Ceiling)', (45,15,"VERIFY","Gang box install; gray if new wiring. Book anchor","anchor: Gang Boxes Remodel Type $90","med")),
 (r'Distribution >.*Junction Box',            (45,10,"VERIFY","Junction box; splice-cover on existing = gray, new = licensed","anchor: General Lighting Gang Boxes $90","med")),
 (r'Distribution >.*(Troubleshoot|Diagonose|Diagnose)',(60,0,"VERIFY","Diagnostic; opening/probing panel is gray for a handyman","research: HomeGuide diag $75-150/hr","med")),

 # ---------- BULBS ----------
 (r'Bulbs >.*Specialty',                      (30,10,False,"Specialty/hard-to-reach bulb swap; maintenance not electrical","anchor: Bulbs Fixture Replace $38 + reach premium","high")),

 # ---------- DOORBELLS: smart ----------
 (r'Doorbells > Smart > Install',             (45,10,False,"Smart doorbell on EXISTING wiring; low-voltage, customer supplies unit","research: Angi labor $150-300 all-in; anchor Doorbell Wireless $65","med")),
 (r'Doorbells > Smart > Program',             (25,0,False,"Config only, no wiring","estimate: quick task","high")),
 (r'Doorbells > Smart > Remove',              (20,0,False,"Removal only","estimate: quick task","high")),
 (r'Doorbells > Smart > Replace',             (40,5,False,"Like-for-like smart doorbell swap on existing wiring","research: Angi $150-300 all-in","med")),
 # ---------- DOORBELLS: wired ----------
 (r'Doorbells > Wired > Diagnose',            (45,0,False,"LV doorbell diagnostic","anchor: Doorbell Wired Diagnose $80","high")),
 (r'Doorbells > Wired > Install New System',  (120,50,"VERIFY","Ground-up wired system w/ new LV wiring; FL limited-energy license gray","research: Angi wired $175-375","med")),
 (r'Doorbells > Wired > Repair Chimes',       (40,10,False,"Repair chime unit inside existing chime box","anchor: Doorbell Wired Replace Chime Box $90","med")),
 (r'Doorbells > Wired > Repair Wiring',       (45,10,False,"Repair existing LV doorbell wiring","anchor: Doorbell Wired Replace Transformer $120","med")),
 (r'Doorbells > Wired > Replace Pushbutton',  (30,10,False,"LV pushbutton swap","anchor: Doorbell Wired Replace Push Button $60","high")),
 (r'Doorbells > Wired > Run New Wiring',      (90,30,"VERIFY","New LV wire run; FL limited-energy license gray","research: CountBricks/Angi $150-350","med")),
 # ---------- DOORBELLS: wireless (all handyman) ----------
 (r'Doorbells > Wireless > Diagnose',         (30,0,False,"Battery doorbell diagnostic","estimate: quick task","high")),
 (r'Doorbells > Wireless > Install New',      (30,15,False,"Battery/wireless doorbell, no mains","anchor: Doorbell Wireless Replace/Install $65","high")),
 (r'Doorbells > Wireless > Replace.*Batteries',(15,10,False,"Battery swap","estimate: quick task; research $45-75","high")),
 (r'Doorbells > Wireless > Replace Wireless Chime Box',(20,25,False,"Wireless chime unit swap","estimate: quick task","high")),
 (r'Doorbells > Wireless > Replace Wireless Pushbutton',(15,15,False,"Wireless button swap","estimate: quick task","high")),
 (r'Doorbells > Wireless > Replace Wireless Repeater',(20,30,False,"Wireless repeater swap","estimate: quick task","high")),
 (r'Doorbells > Wireless > Reprogram',        (15,0,False,"Re-pair devices","estimate: quick task","high")),
 (r'Doorbells > Wireless > Secure',           (15,0,False,"Re-mount device","estimate: quick task","high")),

 # ---------- EXHAUST FANS ----------
 (r'Exhaust Fans > Install New',              (240,120,"REFER","Brand-new bath fan: new duct + new branch wiring; mechanical + electrical permit","research: Homewyse bath fan $343-889; Angi FL $400-700","med")),
 (r'Exhaust Fans > Replace Bulb',             (15,10,False,"Bulb swap","estimate: quick task","high")),
 (r'Exhaust Fans > Replace Cover',            (20,20,False,"Grille/cover swap, existing unit","research: Broan grille $10-25","high")),
 (r'Exhaust Fans > Replace Fan Wheel',        (45,25,False,"Motor/wheel/blade part swap on existing unit","anchor: Exhaust Fan Replace Motor $125; research part swap","med")),

 # ---------- EXTERIOR PATHWAY (low-voltage = handyman) -- must precede generic lighting ----------
 (r'Exterior Pathway > Install New',          (90,30,False,"Low-voltage landscape set (<30V); FL license-exempt","anchor: Hard Wired Pathway Lights $180; research LV set","high")),
 (r'Exterior Pathway > Replace Fixtures',     (30,25,False,"Swap LV pathway fixture","research: Homewyse LV per-fixture $60-130","med")),

 # ---------- LINE-VOLTAGE LIGHTING: 'Install New - Ground Up' = new wiring = REFER ----------
 (r'Can / Recessed > Install New',            (90,40,"REFER","New recessed can w/ new wiring/branch; licensed electrical","research: Homewyse recessed $380-535 all-in","med")),
 (r'Chandelier > Install New',                (120,150,"REFER","Ground-up chandelier w/ new box/wiring; licensed","research: Homewyse chandelier ~$550 all-in; anchor swap $225","med")),
 (r'Dome > Install New',                      (60,50,"REFER","Ground-up flush-mount w/ new wiring; licensed","research: Homewyse ceiling light $230-583","med")),
 (r'Pendant > Install New',                   (75,90,"REFER","Ground-up pendant w/ new wiring; licensed","research: Homewyse pendant $404-594","med")),
 (r'Sconce > Install New',                    (90,60,"REFER","Ground-up wall sconce w/ new wiring; licensed","research: Homewyse sconce (single) ~$400-600","med")),
 (r'Vanity > Install New',                    (75,60,"REFER","Ground-up vanity light w/ new wiring; licensed","research: Homewyse fixture $394-583","med")),
 (r'Under Cabinet > Install New',             (90,80,"VERIFY","Under-cabinet: hardwired=licensed, plug-in LED=handyman","research: Homewyse under-cab $531-673 (hardwired)","low")),
 (r'Track > Install New',                     (100,120,"REFER","Ground-up track w/ new wiring; licensed","research: Homewyse track $549-765","med")),
 (r'Fluorescent > Install New',               (75,60,"REFER","Ground-up fluorescent fixture w/ new wiring; licensed","research: Homewyse fixture $394-583","med")),
 (r'Fluorescent > Replace Ballast',           (45,40,False,"Ballast swap, existing fixture; commonly maintenance","research: HomeGuide $75-175","med")),
 (r'Fluorescent > Upgrade To LED',            (60,80,"VERIFY","LED retrofit: lamp swap=handyman, direct-wire=licensed","research: retrofit $150-450","low")),
 (r'Exterior Flood > Install New',            (75,60,"REFER","Ground-up flood w/ new wiring; licensed (swap would be handyman)","research: Angi floodlight $250-800","med")),
 (r'Exterior Porch > Install New',            (60,50,"REFER","Ground-up porch light w/ new wiring; licensed (swap=handyman)","research: Homewyse fixture; anchor Porch swap $90","med")),

 # ---------- GENERIC LIGHTING ACTIONS (handyman) ----------
 (r'Lighting >.*Install Light Kit',           (45,60,False,"Light kit onto existing fan","research: Angi $100-250","med")),
 (r'Lighting >.*Install Medallion',           (40,40,False,"Cosmetic ceiling medallion","estimate: trim task","med")),
 (r'Lighting >.*(Install / Replace Downrod|Downrod)',(45,30,False,"Fan downrod swap","estimate + research $85-175","med")),
 (r'Lighting >.*Install Remote & Receiver',   (45,20,False,"Add fan remote/receiver kit","anchor: Ceiling Fan Replace/Install Remote $95","med")),
 (r'Lighting >.*Replace Remote',              (40,25,False,"Swap fan remote/receiver","anchor: Replace/Install Remote $95","med")),
 (r'Lighting >.*Reporgram|Reprogram',         (15,0,False,"Re-pair remote","estimate: quick task","high")),
 (r'Lighting >.*Replace LED Light Assembly',  (40,50,False,"Swap integrated LED module","estimate + research $85-175","med")),
 (r'Lighting >.*Replace Pull Chain',          (30,10,False,"Pull-chain switch swap","anchor: Ceiling Fan Replace Pull Chain $60","high")),
 (r'Lighting >.*Replace Pull Switch',         (30,10,False,"Pull switch for fan light swap","anchor: Ceiling Fan Replace Pull Chain $60","high")),
 (r'Lighting > Ceiling Fan > Install Remodel Box',(60,20,"VERIFY","Fan-rated remodel box install; gray if new wiring","anchor: Ceiling Fan Rated Remodel Gang Boxes $120","med")),
 (r'Lighting >.*Balance',                     (30,10,False,"Balance wobbling fan","anchor: Ceiling Fan Balance $60","high")),
 (r'Lighting >.*(Replace Globe|Replace Globes|Globes / Shades)',(25,15,False,"Swap globe/shade","anchor: Ceiling Fan Replace Globes $52","high")),
 (r'Lighting >.*Adjust Length',               (45,0,False,"Adjust chain/rod length","estimate: quick task; research $85-140","med")),
 (r'Lighting > Track > Add Receptacles',      (20,25,False,"Add head to live track","estimate: per-head","med")),
 (r'Lighting > Track > Adjust',               (15,0,False,"Aim/adjust track heads","estimate: quick task","high")),
 (r'Lighting >.*Secure',                      (20,0,False,"Re-secure loose fixture","estimate: quick task","high")),
 (r'Lighting >.*(Diagnose|Troubleshoot)',     (45,0,False,"Lighting diagnostic","research: repair diag $75-150","med")),

 # ---------- SMOKE / CO (all handyman) ----------
 (r'Smoke / CO Detectors >.*Install New.*Battery|Carbon Monoxide > Install New',(30,20,False,"Battery detector mount + unit","anchor: Smoke/CO Replace/Install New $65","high")),
 (r'Smoke / CO Detectors >.*Battery Operated > Install New',(30,20,False,"Battery detector mount + unit","anchor: Smoke/CO Replace/Install New $65","high")),
 (r'Smoke / CO Detectors >.*Replace Detector - Hard Wired',(30,5,False,"Hardwired detector swap on existing base","anchor: Replace hardwired smoke/CO $55","high")),
 (r'Smoke / CO Detectors >.*Replace Detector',(25,20,False,"Detector swap","anchor: Smoke/CO Replace/Install New $65","high")),
 (r'Smoke / CO Detectors >.*Replace Battery', (15,5,False,"Battery swap","estimate: quick task","high")),
 (r'Smoke / CO Detectors >.*Inspect',         (20,0,False,"Inspection","estimate: quick task","high")),
 (r'Smoke / CO Detectors >.*Test',            (15,0,False,"Test alarm","estimate: quick task","high")),
 (r'Smoke / CO Detectors >.*Secure',          (15,0,False,"Re-mount detector","estimate: quick task","high")),
 (r'Smoke / CO Detectors >.*(Diagnose|Troubleshoot)',(30,0,False,"Detector diagnostic","estimate: quick task","high")),

 # ---------- OUTLETS ----------
 (r'Outlets > Repair Loose',                  (20,0,False,"Tighten loose outlet","estimate: quick task","high")),
 (r'Outlets > Repair Outlet Wiring',          (30,5,False,"Re-terminate existing outlet","estimate + anchor Outlets Replace $85","med")),
 (r'Outlets > Replace Outlet \(With Switched',(40,10,False,"Switched-receptacle swap","anchor: Outlets Split/Switch Controlled $95","high")),
 (r'Outlets > Replace Outlet - GFCI',         (30,15,False,"GFCI outlet swap, existing wiring","anchor: GFCI Outlets $95","high")),
 (r'Outlets > Replace Outlet - Standard',     (30,5,False,"Standard outlet swap","anchor: Outlets Replace/Install $85","high")),
 (r'Outlets > Replace Outlet Cover',          (20,3,False,"Cover plate swap","anchor: Outlet Covers Replace $36","high")),
 (r'Outlets > Replace WR',                    (30,15,False,"Weather-resistant outlet swap","anchor: GFCI Outlets $95","high")),
 (r'Outlets > Test',                          (20,0,False,"Test outlets","estimate: quick task","high")),

 # ---------- SWITCHES ----------
 (r'Switches > Diagnose',                     (45,0,False,"Switch-wiring diagnostic","research: diag $75-150","med")),
 (r'Switches > Install Dimmer',               (30,10,False,"Dimmer swap, existing wiring","anchor: Switches Dimmable $95","high")),
 (r'Switches > Install Humidity',             (30,40,False,"Humidity-sensor switch swap","anchor: Switches Sensored $110","med")),
 (r'Switches > Install Movement',             (30,25,False,"Motion-sensor switch swap","anchor: Switches Sensored $110","high")),
 (r'Switches > Install Photocell',            (30,20,False,"Photocell switch swap","anchor: Switches Sensored $110","med")),
 (r'Switches > Install Smart',                (35,35,False,"Smart Wi-Fi switch swap, existing wiring","anchor: Switches Sensored $110; research $160","med")),
 (r'Switches > Install Timer',                (30,25,False,"Timer switch swap","anchor: Switches Sensored $110","med")),
 (r'Switches > Replace 3 Way',                (45,10,False,"3-way switch swap","anchor: Switches 3 Way $110","high")),
 (r'Switches > Replace 4 Way',                (50,12,False,"4-way switch swap","anchor: Switches 3 Way $110 + complexity","med")),
 (r'Switches > Replace Double Pole',          (40,12,False,"Double-pole switch swap","anchor: Switches Replace Install $85 / Sensored $110","med")),
 (r'Switches > Replace Single Pole',          (25,5,False,"Single-pole switch swap","anchor: Switches Replace Install $85","high")),
]

def classify(name):
    for pat, vals in RULES:
        if re.search(pat, name):
            return vals
    return None

src = json.load(open('/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_working.json'))
stubs = src['stubs']

rows=[]
unmatched=[]
for s in stubs:
    name = s['name']
    tax = "Labor > "+name  # taxonomy_path form seen in prep
    r = classify(name)
    if not r:
        unmatched.append(name); continue
    lm, mat, refer, basis, source, conf = r
    p = price(lm, mat)
    flag = "" if refer is False else refer
    rows.append({
        'category':'Electrical','name':name,'taxonomy_path':tax,'unit':'each',
        'market_price':p,'material_allowance':mat,'labor_minutes':lm,
        'basis':basis,'sources':source,'confidence':conf,'flags':flag})

print("matched:",len(rows)," unmatched:",len(unmatched))
if unmatched:
    print("\n=== UNMATCHED (need a rule) ===")
    for u in unmatched: print("  ",u)

os.makedirs('/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run',exist_ok=True)
outp='/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv'
with open(outp,'w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['category','name','taxonomy_path','unit','market_price','material_allowance','labor_minutes','basis','sources','confidence','flags'])
    w.writeheader()
    for r in rows: w.writerow(r)

from collections import Counter
print("\nflags:",dict(Counter(r['flags'] or 'handyman' for r in rows)))
print("conf:",dict(Counter(r['confidence'] for r in rows)))
print("price range: $%d - $%d"%(min(r['market_price'] for r in rows),max(r['market_price'] for r in rows)))
print("wrote",outp)
