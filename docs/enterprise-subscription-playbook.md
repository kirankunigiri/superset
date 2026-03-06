# Enterprise Subscription Admin Playbook

Enterprise subscriptions are created and managed manually by Superset admins in the Stripe Dashboard. Users cannot self-serve into the Enterprise tier.

## Stripe Setup

| Resource | Test | Production |
|---|---|---|
| Product | `prod_U60fzyX291A0Xk` | _(create in prod)_ |
| Price (yearly) | `price_1T7oqXIlnQ8QEVqXGXRg18tG` ($0/yr placeholder) | _(create in prod)_ |

The Enterprise price is a **$0/year placeholder**. The subscription itself just flags the org as enterprise — actual billing is handled through Stripe invoice items or separate invoicing per the negotiated deal. This keeps webhook auto-sync working (Better Auth matches on price ID) while allowing fully custom pricing per customer.

## How It Works

1. **Webhook auto-sync**: When a subscription is created in Stripe Dashboard for a customer whose `stripeCustomerId` matches an org, the `customer.subscription.created` webhook fires → Better Auth's Stripe plugin matches the price ID to the `enterprise` plan → creates a `subscriptions` DB row with `plan: "enterprise"` and `status: "active"`.

2. **No per-seat proration**: Enterprise subscriptions skip the seat-count sync in `afterAddMember` / `afterRemoveMember`. Members can be added/removed without Stripe quantity changes.

3. **Self-service blocked**: The `getCheckoutSessionParams` hook throws an error if someone tries to upgrade to enterprise via the API. The UI also hides all upgrade/downgrade actions for enterprise users.

## Provisioning a New Enterprise Customer

### Prerequisites
- The org must already exist with a `stripeCustomerId` set on the `organizations` table (this happens automatically when an org is created — see `afterCreateOrganization` hook).

### Steps

1. **Find the org's Stripe customer**
   - In the DB: `SELECT id, name, stripe_customer_id FROM auth.organizations WHERE name ILIKE '%OrgName%';`
   - Or search by email in Stripe Dashboard → find the customer with matching `organizationId` metadata.

2. **Cancel existing Pro subscription (if upgrading from Pro)**
   - In Stripe Dashboard → Customer → Subscriptions → Cancel immediately (or at period end, depending on deal terms).
   - The webhook will update the DB subscription status to `canceled`.

3. **Create the Enterprise subscription**
   - In Stripe Dashboard → Customer → **+ Create subscription**
   - Product: **Enterprise**
   - Price: Select the Enterprise yearly price (or create a custom price)
   - Set billing cycle start date as appropriate
   - Optionally add a coupon/discount for the negotiated deal
   - Click **Start subscription**

4. **Add actual billing** (after the $0 subscription is created)
   - Add invoice items to the subscription for the negotiated amount (per-seat fees, usage charges, etc.)
   - Or send separate manual invoices from Stripe for the agreed-upon amount
   - The $0 subscription handles plan status; invoicing handles money

5. **Verify**
   - Check the webhook delivered successfully in Stripe Dashboard → Developers → Webhooks.
   - Verify DB: `SELECT plan, status FROM subscriptions WHERE reference_id = '<org-id>';` should show `enterprise` / `active`.
   - Have the customer sign out and back in (or wait for session refresh) to see the Enterprise UI.

## Offboarding / Downgrading

1. Cancel the Enterprise subscription in Stripe Dashboard (immediately or at period end).
2. The `customer.subscription.deleted` webhook will update the DB status to `canceled`.
3. The org reverts to the free tier automatically.
4. If downgrading to Pro instead, create a new Pro subscription after canceling Enterprise.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Subscription created in Stripe but DB still shows old plan | Webhook didn't fire or failed | Check Stripe → Webhooks → Recent events. Retry the event. |
| Webhook fires but no DB row created | Price ID doesn't match configured env var | Ensure the subscription uses the price in `STRIPE_ENTERPRISE_YEARLY_PRICE_ID`. |
| User still sees Pro/Free after provisioning | Stale session | User needs to sign out/in, or wait up to 5 min for cookie cache to expire. |
| "Enterprise subscriptions are managed by admins" error | User tried to self-upgrade to enterprise via API | Working as intended. |
