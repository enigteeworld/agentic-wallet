import React from "react";

export function Card(props: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-white/80">{props.title}</div>
        {props.right}
      </div>
      {props.children}
    </div>
  );
}
