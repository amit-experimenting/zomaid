import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

export function CardExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Card</h2>
      <Card>
        <CardHeader>
          <CardTitle>Basic card</CardTitle>
          <CardDescription>Description sits under the title.</CardDescription>
        </CardHeader>
        <CardContent>
          Cards group related information. Default size has 16px padding.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Card with footer</CardTitle>
        </CardHeader>
        <CardContent>Some body text that explains what this card is for.</CardContent>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm">Cancel</Button>
          <Button size="sm">Save</Button>
        </div>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Small card</CardTitle>
        </CardHeader>
        <CardContent>Compact padding (12px) and smaller title.</CardContent>
      </Card>
    </section>
  );
}
