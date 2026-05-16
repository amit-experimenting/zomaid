import { Banner } from "./banner";
import { Button } from "./button";

export function BannerExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Banner</h2>

      <div className="space-y-3">
        <Banner tone="info">Plain info banner — no title, no action.</Banner>
        <Banner tone="success">Saved successfully.</Banner>
        <Banner tone="warning">Heads up: this is reaching capacity.</Banner>
        <Banner tone="danger">Something went wrong.</Banner>
        <Banner tone="neutral">Neutral default tone.</Banner>
      </div>

      <div className="space-y-3">
        <Banner tone="info" title="With title">Info banner with a title row above the body.</Banner>
        <Banner tone="success" title="Backup complete">All files synced.</Banner>
        <Banner tone="warning" title="Pantry low">Restock soon.</Banner>
        <Banner tone="danger" title="Sync failed">Tap retry to try again.</Banner>
      </div>

      <div className="space-y-3">
        <Banner
          tone="info"
          title="With action"
          action={<Button size="sm" variant="secondary">Dismiss</Button>}
        >
          Banner with a trailing action button.
        </Banner>
        <Banner
          tone="warning"
          action={<Button size="sm" variant="secondary">Review</Button>}
        >
          Action without a title row.
        </Banner>
      </div>
    </section>
  );
}
