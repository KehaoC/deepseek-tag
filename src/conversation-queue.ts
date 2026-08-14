/** Per-conversation serialization without blocking sibling Lark topics. */

/**
 * Serialize jobs sharing one durable conversation scope. Different scopes run
 * independently, so two topics in one group can own live runtimes at once.
 */
export class ConversationQueue {
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(scope: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(scope) ?? Promise.resolve()
    const result = previous.then(job, job)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(scope, tail)
    void tail.then(() => {
      if (this.tails.get(scope) === tail) this.tails.delete(scope)
    })
    return result
  }
}
