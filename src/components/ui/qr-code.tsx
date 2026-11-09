"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Renders an accessible, sharp SVG QR Code from an opaque payload.
 * Strictly avoids personal identifiable information (PII) in payloads.
 */
export function QrCode({ value, size = 180, className = "" }: QrCodeProps) {
  const [svgData, setSvgData] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    QRCode.toString(
      value,
      {
        type: "svg",
        margin: 1,
        color: {
          dark: "#102D4A",
          light: "#FFFFFF",
        },
      },
      (err, svg) => {
        if (!err && isMounted) {
          setSvgData(svg);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [value]);

  if (!svgData) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`bg-slate-100 animate-pulse rounded-lg flex items-center justify-center text-xs text-[#526B82] ${className}`}
      >
        Generating QR...
      </div>
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`inline-block overflow-hidden rounded-lg border border-slate-200/80 p-1 bg-white shadow-xs ${className}`}
      dangerouslySetInnerHTML={{ __html: svgData }}
    />
  );
}
