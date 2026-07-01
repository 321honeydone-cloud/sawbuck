// PDF text extraction (server-side). Uses pdfjs-dist's Node-safe legacy build.
// The import specifier is held in a variable so the type checker does not need
// pdfjs-dist installed to compile; Node resolves it at runtime. Run
// `npm install` after pulling this so pdfjs-dist is present.

export async function extractPdfText(base64: string): Promise<string> {
  const spec = "pdfjs-dist/legacy/build/pdf.mjs";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(spec);
  const data = new Uint8Array(Buffer.from(base64, "base64"));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: { str?: string }) => it.str ?? "").join(" ") + "\n";
  }
  return text.trim();
}
