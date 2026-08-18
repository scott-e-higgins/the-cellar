import csv, json, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("import_preview.py")

class ImportPreviewTest(unittest.TestCase):
    def test_reports_counts_and_reconciliation_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "fixture.csv"
            with source.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.writer(stream)
                writer.writerow(["Winery", "Wine Name", "Year", "Quantity", "Consumed", "Remaining", "Location"])
                writer.writerow(["Example Winery", "Example Red", "2024", "6", "2", "4", "Rack"])
            result = subprocess.run([sys.executable, str(SCRIPT), str(source)], check=True, capture_output=True, text=True)
            report = json.loads(result.stdout)
            self.assertEqual(report["source_rows"], 1)
            self.assertEqual(report["candidate_wineries"], 1)
            self.assertEqual(report["candidate_wines"], 1)
            self.assertEqual(report["totals"]["remaining"], 4)
            self.assertEqual(report["issue_count"], 0)
            self.assertEqual(report["production_writes"], 0)

if __name__ == "__main__": unittest.main()
