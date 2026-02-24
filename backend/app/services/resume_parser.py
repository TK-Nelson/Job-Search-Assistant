from io import BytesIO
from zipfile import ZipFile
import xml.etree.ElementTree as ET


def extract_docx_text(file_path: str) -> tuple[str, float]:
    try:
        with open(file_path, "rb") as file_handle:
            data = file_handle.read()
    except Exception:
        return "", 0.0
    return extract_docx_text_from_bytes(data)


def extract_docx_text_from_bytes(data: bytes) -> tuple[str, float]:
    try:
        with ZipFile(BytesIO(data)) as archive:
            with archive.open("word/document.xml") as document_xml:
                root = ET.fromstring(document_xml.read())
    except Exception:
        return "", 0.0

    paragraphs: list[str] = []
    for paragraph in root.iter():
        if not paragraph.tag.endswith("}p"):
            continue

        parts: list[str] = []
        for node in paragraph.iter():
            if node.tag.endswith("}t") and node.text is not None:
                parts.append(node.text)
            elif node.tag.endswith("}tab"):
                parts.append("\t")
            elif node.tag.endswith("}br"):
                parts.append("\n")

        paragraph_text = "".join(parts).strip()
        if paragraph_text:
            paragraphs.append(paragraph_text)

    combined = "\n".join(paragraphs).strip()
    confidence = 0.9 if combined else 0.2
    return combined, confidence
