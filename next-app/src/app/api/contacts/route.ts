import { NextResponse } from "next/server";
import { listContacts } from "../../../server/scheduler";

export function GET() {
  const { status, body } = listContacts();
  return NextResponse.json(body, { status });
}

