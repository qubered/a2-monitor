export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border-2 border-dashed border-line-2 bg-paper-2 p-6">
      <strong className="font-display text-cardhead text-foreground">
        {title}
      </strong>
      <p className="mt-1 text-caption text-muted-foreground">{detail}</p>
    </div>
  );
}
