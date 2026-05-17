import { describe, it, expect } from "vitest";
import { withTransaction } from "../setup";
import type { Client } from "pg";

async function fetchFilteredCount(c: Client, matchingTags: string[]): Promise<number> {
  const r = await c.query<{ count: string }>(
    `select count(*) as count
       from public.tasks
      where household_id is null
        and (relevance_tags = '{}' or relevance_tags && $1::text[])`,
    [matchingTags],
  );
  return parseInt(r.rows[0].count, 10);
}

async function fetchUnfilteredCount(c: Client): Promise<number> {
  const r = await c.query<{ count: string }>(
    `select count(*) as count from public.tasks where household_id is null`,
  );
  return parseInt(r.rows[0].count, 10);
}

describe("task relevance filter", () => {
  it("empty matching set still returns universal tasks", async () => {
    await withTransaction(async (c) => {
      const filtered = await fetchFilteredCount(c, []);
      expect(filtered).toBeGreaterThan(50);
    });
  });

  it("minimal profile returns only universal + minimal tagged", async () => {
    await withTransaction(async (c) => {
      const matchingTags = ["age:adults", "pets:none", "work:mixed", "school:none_school_age"];
      const filtered = await fetchFilteredCount(c, matchingTags);
      const all = await fetchUnfilteredCount(c);
      expect(filtered).toBeLessThan(all);
      expect(filtered).toBeGreaterThan(50);
    });
  });

  it("profile with dog pulls in dog tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withDog  = await fetchFilteredCount(c, ["age:adults", "pets:dog",  "work:mixed", "school:none_school_age"]);
      expect(withDog).toBeGreaterThan(without);
    });
  });

  it("profile with infants pulls in baby tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withInfants = await fetchFilteredCount(c, ["age:adults", "age:infants", "pets:none", "work:mixed", "school:none_school_age"]);
      expect(withInfants).toBeGreaterThan(without);
    });
  });

  it("profile with feature:balcony pulls in balcony tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withBalcony = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age", "feature:balcony"]);
      expect(withBalcony).toBe(without + 1);
    });
  });

  it("full-house profile returns close to total", async () => {
    await withTransaction(async (c) => {
      const allTags = [
        "age:infants", "age:school_age", "age:teens", "age:adults", "age:seniors",
        "pets:dog", "pets:cat", "pets:other", "pets:multiple",
        "work:mixed",
        "school:all",
        "feature:plants", "feature:balcony", "feature:ac", "feature:polishables",
      ];
      const filtered = await fetchFilteredCount(c, allTags);
      const all = await fetchUnfilteredCount(c);
      expect(filtered).toBeGreaterThan(all - 5);
    });
  });
});
