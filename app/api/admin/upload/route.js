import { NextResponse } from "next/server";
import { assertAdmin, setData } from "../../../../lib/data-store.js";
import { parseWorkbook } from "../../../../lib/xlsx-parser.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const auth = assertAdmin(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Upload an .xlsx file." }, { status: 400 });
    }

    const data = await parseWorkbook(await file.arrayBuffer());
    const saved = await setData(data);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Admin Excel upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed." },
      { status: 500 }
    );
  }
}
