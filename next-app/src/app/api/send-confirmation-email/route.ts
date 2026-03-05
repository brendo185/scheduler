import { NextResponse } from "next/server";
import { sendConfirmationEmail } from "../../../server/scheduler";

export async function POST(req: Request) {
  const json = (await req.json()) as {
    to: string;
    clientName?: string;
    dateStr: string;
    startTime?: string;
    endTime?: string;
    eventTitle?: string;
    subject?: string;
  };
  const { status, body } = await sendConfirmationEmail(json);
  return NextResponse.json(body, { status });
}

