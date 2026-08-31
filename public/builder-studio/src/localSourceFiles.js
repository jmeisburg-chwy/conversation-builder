export const LOCAL_SOURCE_FILE_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxPdfPages: 50,
  maxCharacters: 120_000
});

const SUPPORTED_EXTENSION = /\.(?:md|pdf|txt)$/iu;

function fileExtension(name) {
  return String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] || "";
}

function cleanExtractedText(value) {
  return String(value || "")
    .split("\u0000")
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertBoundedText(text) {
  if (!text) throw new Error("This file does not contain readable text.");
  if (text.length > LOCAL_SOURCE_FILE_LIMITS.maxCharacters) {
    throw new Error(
      `Keep extracted source text under ${LOCAL_SOURCE_FILE_LIMITS.maxCharacters.toLocaleString()} characters.`
    );
  }
  return text;
}

function textFromPdfItems(items = []) {
  const lines = [];
  let line = [];
  items.forEach((item) => {
    const text = String(item?.str || "").trim();
    if (text) line.push(text);
    if (item?.hasEOL && line.length) {
      lines.push(line.join(" "));
      line = [];
    }
  });
  if (line.length) lines.push(line.join(" "));
  return lines.join("\n");
}

async function defaultPdfModuleLoader() {
  return import("../vendor/pdf.min.mjs");
}

export function supportsLocalSourceFile(file) {
  return Boolean(file && SUPPORTED_EXTENSION.test(String(file.name || "")));
}

export async function readLocalSourceFile(
  file,
  { pdfModuleLoader = defaultPdfModuleLoader } = {}
) {
  if (!supportsLocalSourceFile(file)) {
    throw new Error("Choose a PDF, TXT, or MD file.");
  }
  if (Number(file.size || 0) > LOCAL_SOURCE_FILE_LIMITS.maxBytes) {
    throw new Error("Keep each source file at 5 MB or smaller.");
  }

  const extension = fileExtension(file.name);
  if (extension !== "pdf") {
    return {
      content: assertBoundedText(cleanExtractedText(await file.text())),
      format: extension.toUpperCase(),
      kind: "local_text_file"
    };
  }

  const pdfjs = await pdfModuleLoader();
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/builder-studio/vendor/pdf.worker.min.mjs";
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false
  });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > LOCAL_SOURCE_FILE_LIMITS.maxPdfPages) {
      throw new Error(`Keep PDFs to ${LOCAL_SOURCE_FILE_LIMITS.maxPdfPages} pages or fewer.`);
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pages.push(textFromPdfItems(textContent.items));
    }
    const content = cleanExtractedText(pages.join("\n\n"));
    if (!content) {
      throw new Error("This PDF has no selectable text. Use an OCR-readable PDF, TXT, or MD file.");
    }
    return {
      content: assertBoundedText(content),
      format: "PDF",
      kind: "local_text_file"
    };
  } finally {
    await pdf.destroy?.();
  }
}
