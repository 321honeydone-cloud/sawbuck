import csv, re
SRC='/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv'
rows=list(csv.DictReader(open(SRC)))
def r5(x): return int(round(x/5.0)*5)

# ---- repeat-unit price ----
def additional(r):
    exp=int(r['price_expected']); lm=int(r['labor_minutes']); basis=r['basis'].lower()
    if r['flags'] in ('REFER','VERIFY') or lm>=90 or 'diagnos' in basis or 'troubleshoot' in basis:
        f=0.85
    elif r['confidence']=='high' and lm<=30:
        f=0.55
    else:
        f=0.70
    add=max(20, r5(exp*f))
    return min(add, exp-5)

# ---- customer-facing refer note ----
def refer_note(name, flag):
    if flag not in ('REFER','VERIFY'): return ''
    n=name
    if re.search(r'Breaker|Replace Fuse|Run New Leg|Run New Conduit', n):
        return "Panel, breaker, and new-circuit work requires a licensed electrician and a Brevard County permit. We coordinate a licensed sub so it is done to code and insured."
    if 'Exhaust Fans > Install New' in n:
        return "A brand-new bath fan means new duct and new wiring, which needs mechanical and electrical permits and a licensed sub. We coordinate the whole job."
    if re.search(r'(Doorbells > Wired > Install New System|Doorbells > Wired > Run New Wiring)', n):
        return "New low-voltage wiring can fall under Florida limited-energy licensing. We confirm scope first and sub it out if a license is required."
    if re.search(r'(Gang Box|Junction Box|Ceiling Fan Rated Box|Weatherproof Gang Box|Install Remodel Box)', n):
        return "A like-for-like box on existing wiring we handle. If it needs new wiring it becomes licensed electrical work and we refer it out. We confirm on site."
    if re.search(r'Troubleshoot|Diagnose', n):
        return "We do the visual and load-side checks. Anything inside the panel is licensed electrical work and we refer it to a licensed electrician."
    if re.search(r'(Under Cabinet > Install New|Fluorescent > Upgrade To LED)', n):
        return "Plug-in or lamp-only versions we handle. Hardwired versions are licensed electrical work; we confirm which on site."
    if 'Install New - Ground Up' in n:
        return "A brand-new fixture location needs new wiring, which requires a licensed electrician and a permit. We coordinate; a licensed sub does the wiring."
    return "This scope may require a licensed electrician and a permit. We confirm before quoting and coordinate a licensed sub if needed."

fields=['category','name','display_name','taxonomy_path','unit',
        'price_expected','price_additional','price_max_guarantee',
        'material_allowance','labor_minutes','haul_off','rate_year',
        'refer_note','basis','sources','confidence','flags']
out=[]
for r in rows:
    r2=dict(r)
    r2['price_additional']=additional(r)
    r2['refer_note']=refer_note(r['name'], r['flags'])
    out.append({k:r2.get(k,'') for k in fields})

for path in ['/sessions/bold-relaxed-brown/mnt/outputs/ratebook-run/electrical_review.csv',
             '/sessions/bold-relaxed-brown/mnt/handoff/ratebook-run/electrical_review.csv']:
    with open(path,'w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(out)

print("rows:",len(out)," columns:",len(fields))
print("\nrepeat-unit examples (first -> each additional):")
for nm in ['Replace Outlet - Standard','Replace 3 Way Switch','Install New - Ground Up','Chandelier > Install New','Replace Battery']:
    for r in out:
        if nm in r['name']:
            print(f"  ${r['price_expected']:>4} -> ${r['price_additional']:>4}   {r['display_name']}"); break
print("\nrefer notes populated:",sum(1 for r in out if r['refer_note']),"of",len(out),"(REFER+VERIFY only)")
print("\nsample refer note:")
for r in out:
    if r['flags']=='REFER': print("  ["+r['display_name']+"]\n   ->",r['refer_note']); break
