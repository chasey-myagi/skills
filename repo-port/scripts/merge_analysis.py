#!/usr/bin/env python3
"""
Merge .analysis/*.md files into issue-found.md and optimization-found.md.

Each analysis file has two sections: ## Issues and ## Optimizations.
This script extracts them and groups by type across all files in the module.

Requires: Python 3.9+

Usage:
    python merge_analysis.py <module-workspace-dir>

Example:
    python merge_analysis.py /path/to/port-workspace/sage

Assumption: analysis files do not use ## headings inside issue/optimization
descriptions (only at section boundaries). If they do, extraction will truncate.
"""

import sys
import re
from pathlib import Path


def extract_section(content: str, section_name: str) -> str:
    pattern = rf"## {section_name}\n(.*?)(?=\n## |\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""


def merge_analysis(module_dir: str) -> None:
    module_path = Path(module_dir)
    analysis_dir = module_path / ".analysis"

    if not analysis_dir.exists():
        print(f"No .analysis/ directory in {module_dir}", file=sys.stderr)
        sys.exit(1)

    analysis_files = sorted(analysis_dir.glob("*.md"))
    if not analysis_files:
        print("No analysis files found", file=sys.stderr)
        sys.exit(1)

    issues_sections: list[str] = []
    opts_sections: list[str] = []

    for f in analysis_files:
        content = f.read_text(encoding="utf-8")

        # Extract source path from header "# Analysis: path/to/file"
        first_line = content.split("\n")[0]
        source_path = first_line.removeprefix("# Analysis:").strip()

        issues = extract_section(content, "Issues")
        opts = extract_section(content, "Optimizations")

        if issues and issues != "(none)":
            issues_sections.append(f"## {source_path}\n\n{issues}")

        if opts and opts != "(none)":
            opts_sections.append(f"## {source_path}\n\n{opts}")

    issue_out = module_path / "issue-found.md"
    with issue_out.open("w", encoding="utf-8") as f:
        f.write("# Issues Found\n\n")
        if issues_sections:
            f.write("\n\n---\n\n".join(issues_sections))
            f.write("\n")
        else:
            f.write("(none)\n")

    opt_out = module_path / "optimization-found.md"
    with opt_out.open("w", encoding="utf-8") as f:
        f.write("# Optimizations Found\n\n")
        if opts_sections:
            f.write("\n\n---\n\n".join(opts_sections))
            f.write("\n")
        else:
            f.write("(none)\n")

    print(f"Merged {len(analysis_files)} analysis files")
    print(f"  issue-found.md     — {len(issues_sections)} files with issues")
    print(f"  optimization-found.md — {len(opts_sections)} files with optimizations")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python merge_analysis.py <module-workspace-dir>")
        sys.exit(1)
    merge_analysis(sys.argv[1])
