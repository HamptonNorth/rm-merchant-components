// client/harness/flows.js — component sequences, and how each step feeds the next.
//
// Components are developed one page at a time, which tests each in isolation and tests the
// joins between them not at all. The joins are where this project has already come closest
// to shipping something wrong: `isHome` versus `isDefault` versus `isCustomerHome` was a
// naming collision only visible with two components in the same room.
//
// A flow is a list of steps. Each step names a component and declares what it consumes from
// the events already seen. `needs` gates the step: until those context keys exist it renders
// as waiting rather than erroring, so the sequence reads correctly from cold.

export const flows = [
  {
    id: "counter-sale",
    title: "Counter sale",
    description:
      "The everyday path. Sign in at a branch, find the customer at the counter, check they can have the goods, and pick where it is going if it is not going with them.",
    steps: [
      {
        component: "working-branch",
        note: "Sign-in: which branch is this counter?",
        props: { userId: 158 },
        // The working branch scopes everything downstream, so it is step one rather than a
        // setting hidden in a panel.
        emits: {
          "merchant-working-branch-changed": (d) => ({ workingBranchId: d.id, workingBranchName: d.name }),
        },
      },
      {
        component: "find-customer",
        note: "Find the customer",
        needs: ["workingBranchId"],
        props: (ctx) => ({ workingBranchId: ctx.workingBranchId }),
        emits: {
          "merchant-customer-selected": (d) => ({
            customerId: d.id,
            customerName: d.name,
            customerAccountCode: d.accountCode,
            customerAccountType: d.accountType,
            customerHomeBranchId: d.homeBranchId,
            matchedOn: d.matchedOn,
          }),
        },
      },
      {
        component: "credit-status",
        note: "Can they have the goods?",
        needs: ["customerId"],
        props: (ctx) => ({ customerId: ctx.customerId, pageSize: 5 }),
        emits: {
          "merchant-credit-checked": (d) => ({ verdict: d.verdict, headroomPence: d.headroomPence }),
        },
      },
      {
        component: "delivery-address",
        note: "Where is it going? (skip for a collect)",
        needs: ["customerId"],
        props: (ctx) => ({ customerId: ctx.customerId }),
        emits: {
          "merchant-delivery-address-selected": (d) => ({
            deliveryAddressId: d.id,
            unloadMethod: d.unloadMethod,
          }),
        },
      },
    ],
  },
  {
    id: "staff-context",
    title: "Staff sign-in",
    description:
      "What a member of staff may do once they have chosen where they are working. The permissions card scopes itself to the branch chosen above it.",
    steps: [
      {
        component: "working-branch",
        note: "Choose the working branch",
        props: { userId: 158 },
        emits: {
          "merchant-working-branch-changed": (d) => ({ workingBranchId: d.id, userId: d.userId }),
        },
      },
      {
        component: "user-permissions-view",
        note: "What can I do here?",
        needs: ["workingBranchId"],
        props: (ctx) => ({ userId: ctx.userId ?? 158, workingBranchId: ctx.workingBranchId }),
      },
    ],
  },
];

export function flowById(id) {
  return flows.find((f) => f.id === id) ?? null;
}

// Cross-component checks — the ones no single component can make, because each holds only
// half the facts (docs/plan.md §0).
export function flowWarnings(ctx) {
  const out = [];

  if (ctx.verdict === "on_stop") {
    out.push({
      level: "stop",
      text: `${ctx.customerName ?? "This customer"} is ON STOP — do not release goods.`,
    });
  } else if (ctx.verdict === "over_limit") {
    out.push({
      level: "stop",
      text: `${ctx.customerName ?? "This customer"} is over their credit limit.`,
    });
  } else if (ctx.verdict === "near_limit") {
    out.push({ level: "warn", text: "Close to the credit limit — check the order value." });
  }

  // The Warrington-plumber-in-London case. Neither find-customer nor credit-status can see
  // this on its own: one knows the working branch, the other knows who owns the account.
  if (
    ctx.workingBranchId != null &&
    ctx.customerHomeBranchId != null &&
    ctx.workingBranchId !== ctx.customerHomeBranchId
  ) {
    out.push({
      level: "warn",
      text:
        `${ctx.customerName ?? "This customer"} is owned by another branch. ` +
        `Their pricing and credit relationship sits there, not at ${ctx.workingBranchName ?? "this branch"}.`,
    });
  }

  if (ctx.customerAccountType === "cash" && ctx.deliveryAddressId) {
    out.push({
      level: "info",
      text: "Cash account with a delivery address — settle before the goods leave.",
    });
  }

  return out;
}
