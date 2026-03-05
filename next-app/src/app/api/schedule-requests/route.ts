import { NextResponse } from "next/server";
import { listScheduleRequests } from "../../../server/scheduler";

export function GET() {
  const { status, body } = listScheduleRequests();
  return NextResponse.json(body, { status });
}

