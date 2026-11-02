"use client";

import dynamic from "next/dynamic";

// Settings and Web Serial only exist in the browser, so this page renders there alone.
const ScanApp = dynamic(
  () => import("@/components/ScanApp").then((m) => m.ScanApp),
  { ssr: false },
);

export default function Home() {
  return <ScanApp />;
}
