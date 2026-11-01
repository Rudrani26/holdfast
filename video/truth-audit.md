# Truth audit — final demo video

Run 2026-11-01T02:40:36.742Z with read-only GET calls to the PayPal Sandbox (`video/build/truth-audit.ts`).

| Scene | Object | ID | Shown on screen | Verified with PayPal |
| --- | --- | --- | --- | --- |
| 02-book (J1) | order | `5UK7089516358800F` | order created; authorization placed | COMPLETED |
| 02-book (J1) | authorization | `22X40097DE206973U` | CREATED, $200.00, expires Nov 30, 2026 | VOIDED, $200.00, expires 2026-11-30T01:15:00Z |
| 06-settle (J1) | capture | `3AK885510K404981V` | COMPLETED, $76.00 | COMPLETED, $76.00 |
| 06-settle (J1) | authorization | `22X40097DE206973U` | VOIDED (remainder) | VOIDED, $200.00, expires 2026-11-30T01:15:00Z |
| 08-clean (J2) | authorization | `7CL065587Y652090U` | VOIDED, $0 charged | VOIDED, $60.00, expires 2026-11-30T00:58:02Z |
| 09-contest (J3) | authorization | `3RE78577G3579781P` | VOIDED, $0 charged | VOIDED, $120.00, expires 2026-11-30T01:01:00Z |
| 06-settle (J1) | webhook event | `WH-2340001800281321K-5PP46019SV010294C` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.CREATED → 22X40097DE206973U CREATED |
| 06-settle (J1) | webhook event | `WH-9FK58463D4251682K-4E976668U8177663V` | "PayPal-confirmed" badge | PAYMENT.CAPTURE.COMPLETED → 3AK885510K404981V COMPLETED |
| 06-settle (J1) | webhook event | `WH-0FA27087VH250763L-0CM53756NE434301P` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.VOIDED → 22X40097DE206973U VOIDED |
| 08-clean (J2) | webhook event | `WH-9GV68671159227602-43547732U6238854D` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.CREATED → 7CL065587Y652090U CREATED |
| 08-clean (J2) | webhook event | `WH-10G910584B1912809-06P43368JE4580207` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.VOIDED → 7CL065587Y652090U VOIDED |
| 09-contest (J3) | webhook event | `WH-9YN33173KR753843X-5V827982L04695636` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.CREATED → 3RE78577G3579781P CREATED |
| 09-contest (J3) | webhook event | `WH-4G740289AK5372503-371952988A313605S` | "PayPal-confirmed" badge | PAYMENT.AUTHORIZATION.VOIDED → 3RE78577G3579781P VOIDED |

An authorization's status is its current one: `22X40097DE206973U` was `CREATED` when the booking scene was filmed and is `VOIDED` now that the remainder was voided (scene 06), so both on-screen values are consistent with PayPal's history.
