import { NextResponse } from "next/server";
import { assertAdmin, setData } from "../../../../lib/data-store.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const auth = assertAdmin(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const data = await request.json();
    const saved = await setData(data);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Admin data save failed:", error);
    return NextResponse.json(
      { error: error.message || "Save failed." },
      { status: 500 }
    );
  }
}
