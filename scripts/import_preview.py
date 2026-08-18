#!/usr/bin/env python3
"""Read-only Cellar spreadsheet profiler. It never connects to Supabase or writes production data."""
from __future__ import annotations
import argparse, csv, json, re, zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
DEFAULT_ALIASES = {
    "winery": ["winery", "producer"], "wine": ["wine", "wine name", "name"], "vintage": ["vintage", "year"],
    "acquired_date": ["acquired date", "purchase date", "date acquired"], "quantity": ["quantity", "purchased", "qty"],
    "consumed": ["consumed", "opened", "drank"], "remaining": ["remaining", "on hand", "current quantity"],
    "unit_price": ["price", "unit price"], "total_cost": ["total", "total cost"], "current_value": ["current value", "value"],
    "storage": ["storage", "location"], "person": ["who", "purchased by", "selected by"], "buy_again": ["buy again"],
}

def col_number(cell_ref: str) -> int:
    n = 0
    for char in re.match(r"[A-Z]+", cell_ref).group(0): n = n * 26 + ord(char) - 64
    return n - 1

def read_xlsx(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml")); shared = ["".join(node.itertext()) for node in root.findall("m:si", NS)]
        workbook = ET.fromstring(archive.read("xl/workbook.xml")); first = workbook.find("m:sheets/m:sheet", NS)
        rel_id = first.attrib[f"{{{NS['r']}}}id"]; rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_ns = {"p": "http://schemas.openxmlformats.org/package/2006/relationships"}; target = next(r.attrib["Target"] for r in rels.findall("p:Relationship", rel_ns) if r.attrib["Id"] == rel_id)
        sheet_path = "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
        root = ET.fromstring(archive.read(sheet_path)); rows = []
        for row in root.findall(".//m:sheetData/m:row", NS):
            values = []
            for cell in row.findall("m:c", NS):
                index = col_number(cell.attrib["r"])
                while len(values) <= index: values.append("")
                value = cell.find("m:v", NS); raw = "" if value is None else value.text or ""
                if cell.attrib.get("t") == "s" and raw: raw = shared[int(raw)]
                elif cell.attrib.get("t") == "inlineStr": raw = "".join(cell.itertext())
                values[index] = raw.strip()
            rows.append(values)
        return rows
def read_rows(path: Path) -> list[list[str]]:
    if path.suffix.lower() == ".xlsx": return read_xlsx(path)
    if path.suffix.lower() in {".csv", ".tsv"}:
        with path.open("r", encoding="utf-8-sig", newline="") as stream: return list(csv.reader(stream, delimiter="\t" if path.suffix.lower()==".tsv" else ","))
    raise ValueError("Supported source formats are .xlsx, .csv, and .tsv")
def numeric(value: str) -> float | None:
    try: return float(re.sub(r"[$,]", "", value)) if value.strip() else None
    except ValueError: return None
def valid_date(value: str) -> bool:
    if not value.strip(): return True
    if numeric(value) and float(value) > 20000: return True
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y"):
        try: datetime.strptime(value.strip(), fmt); return True
        except ValueError: pass
    return False
def main() -> None:
    parser=argparse.ArgumentParser(description="Create a read-only Cellar import preview");parser.add_argument("source",type=Path);parser.add_argument("--mapping",type=Path);parser.add_argument("--output",type=Path);args=parser.parse_args()
    grid=read_rows(args.source); assert grid, "Spreadsheet is empty"; headers=[h.strip() for h in grid[0]]; normalized={h.lower():i for i,h in enumerate(headers)}
    configured=json.loads(args.mapping.read_text()) if args.mapping else {}; mapping={}
    for field,aliases in DEFAULT_ALIASES.items():
        wanted=configured.get(field); candidates=[wanted] if wanted else aliases; mapping[field]=next((normalized[c.lower()] for c in candidates if c and c.lower() in normalized),None)
    records=[]
    for source_row,row in enumerate(grid[1:],2):
        if not any(v.strip() for v in row): continue
        record={field:(row[index].strip() if index is not None and index<len(row) else "") for field,index in mapping.items()};record["source_row"]=source_row;records.append(record)
    issues=[]; wineries=Counter();wines=Counter();locations=Counter();people=Counter();totals={"purchased":0.0,"consumed":0.0,"remaining":0.0,"source_cost":0.0}
    for r in records:
        winery=r["winery"].strip();wine=r["wine"].strip();vintage=r["vintage"].strip().upper() or "UNKNOWN"; qty=numeric(r["quantity"]);consumed=numeric(r["consumed"]);remaining=numeric(r["remaining"])
        if not wine: issues.append({"row":r["source_row"],"type":"missing_wine_name"})
        if not valid_date(r["acquired_date"]): issues.append({"row":r["source_row"],"type":"invalid_date","value":r["acquired_date"]})
        for key,value in (("quantity",qty),("consumed",consumed),("remaining",remaining)):
            if r[key] and value is None: issues.append({"row":r["source_row"],"type":f"invalid_{key}","value":r[key]})
            if value is not None and value < 0: issues.append({"row":r["source_row"],"type":f"negative_{key}","value":value})
        if qty is not None and consumed is not None and remaining is not None and abs(qty-consumed-remaining)>0.001: issues.append({"row":r["source_row"],"type":"quantity_reconciliation","purchased":qty,"consumed":consumed,"remaining":remaining})
        if winery: wineries[winery.casefold()]+=1
        if wine: wines[(winery.casefold(),wine.casefold(),vintage)]+=1
        if r["storage"]: locations[r["storage"].casefold()]+=1
        if r["person"]: people[r["person"].casefold()]+=1
        totals["purchased"]+=qty or 0;totals["consumed"]+=consumed or 0;totals["remaining"]+=remaining or 0;totals["source_cost"]+=numeric(r["total_cost"]) or 0
    report={"mode":"dry-run-only","source_file":args.source.name,"source_rows":len(records),"headers":headers,"resolved_mapping":{field:(headers[index] if index is not None else None) for field,index in mapping.items()},"candidate_wineries":len(wineries),"candidate_wines":len(wines),"candidate_purchase_items":len(records),"locations":sorted(locations),"people_values":sorted(people),"totals":totals,"issue_count":len(issues),"issues":issues,"production_writes":0}
    output=json.dumps(report,indent=2);args.output.write_text(output+"\n") if args.output else print(output)
if __name__=="__main__": main()
