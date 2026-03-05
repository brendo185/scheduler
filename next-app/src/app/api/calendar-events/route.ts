import { NextResponse } from "next/server";
import { getCalendarEvents } from "../../../server/scheduler-pg";

export async function GET() {
  const { status, body } = await getCalendarEvents();
  return NextResponse.json(body, { status });
}

