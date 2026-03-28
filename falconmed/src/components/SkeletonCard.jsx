import React from "react";

const defaultBlocks = [
  { width: "38%", height: 10, gap: 12 },
  { width: "62%", height: 30, gap: 12 },
  { width: "84%", height: 10, gap: 0 },
];

export default function SkeletonCard({
  style,
  blocks = defaultBlocks,
  className = "",
  contentStyle,
}) {
  return (
    <div className={className} style={style} aria-hidden="true">
      <div style={contentStyle}>
        {blocks.map((block, index) => (
          <div
            key={`${block.width}-${block.height}-${index}`}
            className="skeleton-shimmer"
            style={{
              width: block.width,
              height: block.height,
              borderRadius: block.radius ?? 999,
              marginBottom: block.gap ?? 10,
            }}
          />
        ))}
      </div>
    </div>
  );
}
