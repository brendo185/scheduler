import { NextResponse } from "next/server";
import { listContacts } from "../../../server/scheduler-pg";

export async function GET() {
  const { status, body } = await listContacts();
  return NextResponse.json(body, { status });
}

