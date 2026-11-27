// {{title}} — a magpie routing strategy (and optionally a usage observer).
//
// Runs inside magpie's own process on moejs: one file, relative imports only,
// no timers, no fetch, no Node APIs. Each strategy shows in every routing
// picker as `{{short}}/<name>`, beside magpie's own (smart, order, rotate,
// usage, pace, weight).
//
// A strategy is (pool, seats, options) => indexes, or { order }. Each seat has:
//   key       the account or key it stands for
//   account   whether it is a subscription account
//   known     whether its allowance is known
//   learns    whether magpie is still learning its pace
//   used      how much of its allowance is used, 0–100 (or more, overspent)
//   soon      when its windows renew, in ms from now (soonest first)
//   pace      how fast it is spending against its allowance
//   weight    its configured weight
//   resting   whether it is resting after a failure
//   tokens    how much it was sent lately
// It has 20 ms. A throw, a timeout or anything but a permutation of the seats
// leaves them in their listed order.

export const strategies = {
  // magpie reads nested groups: `{ group: { name: fn } }`. `{{short}}` is the
  // short name of this package, so these list as `{{short}}/pick/most-room`.
  pick: {
    // Accounts with the most room first; a resting seat last.
    'most-room': (pool, seats, options) => {
      void pool
      void options
      return seats
        .map((_, index) => index)
        .sort((a, b) => (Number(seats[a].resting) - Number(seats[b].resting)) || (Number(seats[a].used) - Number(seats[b].used)))
    },

    // Fill each seat up to a share of its allowance, then move on.
    'fill-then-next': (pool, seats, options) => {
      void pool
      const ceiling = Number(options?.ceiling ?? 80)
      // A seat whose allowance is not known yet is not full: it goes with the
      // seats that still have room, ahead of the ones already filled.
      const filled = (seat) => Boolean(seat.known) && Number(seat.used) >= ceiling
      return seats
        .map((_, index) => index)
        .sort((a, b) => {
          const fa = filled(seats[a]) ? 1 : 0
          const fb = filled(seats[b]) ? 1 : 0
          if (fa !== fb) return fa - fb
          return (Number(seats[a].resting) - Number(seats[b].resting)) || (Number(seats[a].used) - Number(seats[b].used))
        })
    },
  },
}

// Optional: each request's usage row after it ends. Never a body or a prompt.
// export function onUsage(row, options) {
//   if (row.ms > (options.slowMs ?? 30000)) console.log(`slow: ${row.provider} ${row.model} ${row.ms} ms`)
// }
