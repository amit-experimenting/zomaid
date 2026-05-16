import { Button } from "./button";

export function ButtonExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Button</h2>
      <div className="flex flex-wrap gap-3">
        <Button size="sm">Small (extends row)</Button>
        <Button size="md">Medium (default)</Button>
        <Button size="lg">Large</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button disabled>Disabled</Button>
        <Button loading>Loading</Button>
      </div>
    </section>
  );
}
