from pathlib import Path
import subprocess


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHECKED_SUFFIXES = {".py", ".ts", ".tsx", ".json", ".html"}


def test_tracked_sources_are_clean_utf8_without_bom_or_mojibake():
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    broken_question_sequence = "?" * 4
    mojibake_markers = ("Р" + "ЎР", "Р" + "џР", "Р" + "ќР", "Р" + "‘Р")
    failures: list[str] = []
    for relative_path in result.stdout.splitlines():
        path = PROJECT_ROOT / relative_path
        if path.suffix.lower() not in CHECKED_SUFFIXES or not path.is_file():
            continue
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            failures.append(f"{relative_path}: UTF-8 BOM")
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            failures.append(f"{relative_path}: не UTF-8")
            continue
        if broken_question_sequence in text:
            failures.append(f"{relative_path}: повреждённая строка из знаков вопроса")
        if any(marker in text for marker in mojibake_markers):
            failures.append(f"{relative_path}: mojibake")
    assert not failures, "\n".join(failures)
