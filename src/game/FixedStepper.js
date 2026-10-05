// Staly krok symulacji niezalezny od liczby klatek renderowania.
// Ramka renderingu dodaje swoj czas do akumulatora; fizyka wykonuje tyle krokow 1/120 s, ile sie miesci.
// alpha (0..1) sluzy do interpolacji pozycji miedzy dwoma ostatnimi stanami fizyki przy rysowaniu.
export class FixedStepper {
  constructor(stepHz = 120, maxFrameTime = 0.1) {
    this.dt = 1 / stepHz;
    this.maxFrameTime = maxFrameTime;
    this.acc = 0;
    this.alpha = 0;
    this.steps = 0;
  }

  /** frameTime w sekundach; stepFn(dt) wolane 0..n razy; zwraca liczbe krokow */
  advance(frameTime, stepFn) {
    this.acc += Math.min(Math.max(frameTime, 0), this.maxFrameTime);
    let n = 0;
    while (this.acc >= this.dt - 1e-9) {
      stepFn(this.dt);
      this.acc -= this.dt;
      n++;
    }
    this.alpha = this.acc / this.dt;
    this.steps += n;
    return n;
  }

  reset() {
    this.acc = 0;
    this.alpha = 0;
  }
}
