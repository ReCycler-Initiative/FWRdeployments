from pathlib import Path

from docx import Document
from pypdf import PdfReader


def extract_text(path: Path) -> str:
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("Taustatiedoston enimmäiskoko on 10 Mt.")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Salattua PDF-tiedostoa ei voida lukea.")
        if len(reader.pages) > 100:
            raise ValueError("PDF saa sisältää enintään 100 sivua.")
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        document = Document(path)
        text = "\n".join(
            [paragraph.text for paragraph in document.paragraphs]
            + [" | ".join(cell.text for cell in row.cells)
               for table in document.tables for row in table.rows]
        )
    elif suffix in {".txt", ".md", ".csv", ".json", ".vtt"}:
        text = path.read_text(encoding="utf-8-sig")
    else:
        raise ValueError("Taustatiedoston tyyppiä ei tueta.")
    if not text.strip():
        raise ValueError("Tiedostosta ei löytynyt tekstiä. Skannattu PDF tarvitsee OCR-käsittelyn.")
    if "\0" in text or len(text) > 100000:
        raise ValueError("Poimittu teksti on virheellinen tai ylittää 100 000 merkin rajan.")
    return text
