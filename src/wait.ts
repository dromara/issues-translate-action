export async function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof milliseconds !== 'number' || Number.isNaN(milliseconds)) {
      reject(new Error('milliseconds not a number'))
      return
    }
    setTimeout(() => resolve(), milliseconds)
  })
}
