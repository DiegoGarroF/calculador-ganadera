import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  PLATFORM_ID,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

interface SavedState {
  budget?: number | null;
  weight?: number | null;
  auctionPrice?: number | null;
  purchases?: unknown[];
}

interface Purchase {
  id: string;
  createdAt: string;
  weight: number;
  price: number;
  total: number;
}

interface StatusMessage {
  css: string;
  text: string;
}

export type View = 'calculadora' | 'resumen' | 'subasta';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild('weightInput') private weightInput?: ElementRef<HTMLInputElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'calculadora-subasta-ganado';
  private readonly defaultBudget = 0;

  readonly budget = signal<number | null>(this.defaultBudget);
  readonly weight = signal<number | null>(null);
  readonly auctionPrice = signal<number | null>(null);
  readonly purchases = signal<Purchase[]>([]);
  readonly savedMessage = signal<string | null>(null);

  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly activeView = signal<View>('calculadora');
  readonly sidebarOpen = signal(false);

  readonly viewTitle = computed(() => {
    switch (this.activeView()) {
      case 'resumen':
        return 'Resumen de compra';
      case 'subasta':
        return 'Precio de subasta';
      default:
        return 'Calculadora';
    }
  });

  readonly maxPrice = computed<number | null>(() => {
    const budget = this.budget();
    const weight = this.weight();
    if (budget === null || budget <= 0 || weight === null || weight <= 0) {
      return null;
    }
    return budget / weight;
  });

  readonly maxPriceText = computed(() => this.money(this.maxPrice()));

  readonly maxHint = computed(() => {
    const weight = this.weight();
    const max = this.maxPrice();
    if (weight === null || weight <= 0 || max === null) {
      return 'Introduce un peso mayor que cero para calcular tu límite.';
    }
    return `Con ${this.formatNumber(weight)} kg, pagar más de ${this.money(max)} por kilo supera tu presupuesto.`;
  });

  readonly weightSummary = computed(() => {
    const weight = this.weight();
    if (weight === null) {
      return '—';
    }
    return weight > 0 ? `${this.formatNumber(weight)} kg` : 'Peso inválido';
  });

  readonly budgetSummary = computed(() => this.money(this.budget()));

  readonly priceSummary = computed(() => {
    const max = this.maxPrice();
    return max === null ? '—' : `${this.money(max)} / kg`;
  });

  readonly status = computed<StatusMessage>(() => {
    const budget = this.budget();
    if (budget === null || budget <= 0) {
      return { css: 'status', text: 'Introduce un presupuesto mayor que ₡0' };
    }
    const max = this.maxPrice();
    if (max === null) {
      return { css: 'status', text: 'Esperando un peso válido' };
    }
    return { css: 'status ok', text: `Límite calculado · No superar ${this.money(max)} por kilo` };
  });

  readonly auctionStatus = computed<StatusMessage>(() => {
    const budget = this.budget();
    const weight = this.weight();
    const max = this.maxPrice();
    const price = this.auctionPrice();
    if (budget === null || weight === null || max === null || price === null || price < 0) {
      return { css: 'status', text: 'Puedes dejarlo vacío si solo necesitas tu límite máximo.' };
    }
    const total = price * weight;
    if (price <= max) {
      return {
        css: 'status ok',
        text: `DENTRO DEL PRESUPUESTO · Total estimado: ${this.money(total)} · Te quedarían ${this.money(Math.max(0, budget - total))}`,
      };
    }
    return {
      css: 'status over',
      text: `SUPERA TU LÍMITE · Total estimado: ${this.money(total)} · Excede el presupuesto por ${this.money(total - budget)}`,
    };
  });

  readonly purchasePrice = computed<number | null>(() => {
    const auction = this.auctionPrice();
    if (auction !== null && auction >= 0) {
      return auction;
    }
    return this.maxPrice();
  });

  readonly canPurchase = computed(() => this.purchasePrice() !== null);

  readonly purchaseCount = computed(() => this.purchases().length);

  readonly purchaseKilos = computed(() =>
    this.purchases().reduce((sum, purchase) => sum + purchase.weight, 0)
  );

  readonly purchaseAmount = computed(() =>
    this.purchases().reduce((sum, purchase) => sum + purchase.total, 0)
  );

  constructor() {
    afterNextRender(() => this.restore());
  }

  selectView(view: View): void {
    this.activeView.set(view);
    this.sidebarOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  blurOnWheel(event: Event): void {
    (event.target as HTMLElement | null)?.blur();
  }

  setBudget(value: number | null): void {
    this.budget.set(value);
    this.save();
  }

  setWeight(value: number | null): void {
    this.weight.set(value);
    this.save();
  }

  setAuctionPrice(value: number | null): void {
    this.auctionPrice.set(value);
    this.save();
  }

  addPurchase(): void {
    const weight = this.weight();
    const price = this.purchasePrice();
    if (weight === null || weight <= 0 || price === null) {
      return;
    }
    const purchase: Purchase = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      weight,
      price,
      total: price * weight,
    };
    this.purchases.update((list) => [purchase, ...list]);
    this.weight.set(null);
    this.auctionPrice.set(null);
    this.save();
    this.savedMessage.set(
      `Compra guardada · ${this.formatNumber(purchase.weight)} kg a ${this.money(purchase.price)}/kg`
    );
    if (this.savedTimer !== null) {
      clearTimeout(this.savedTimer);
    }
    this.savedTimer = setTimeout(() => this.savedMessage.set(null), 3000);
  }

  removePurchase(id: string): void {
    this.purchases.update((list) => list.filter((purchase) => purchase.id !== id));
    this.save();
  }

  clearPurchases(): void {
    if (isPlatformBrowser(this.platformId) && !window.confirm('¿Borrar todas las compras guardadas?')) {
      return;
    }
    this.purchases.set([]);
    this.save();
  }

  adjustWeight(delta: number): void {
    this.setWeight(Math.max(0, (this.weight() ?? 0) + delta));
  }

  focusWeight(): void {
    this.weight.set(null);
    this.auctionPrice.set(null);
    this.save();
    this.weightInput?.nativeElement.focus();
  }

  reset(): void {
    this.budget.set(this.defaultBudget);
    this.weight.set(null);
    this.auctionPrice.set(null);
    this.save();
    this.activeView.set('calculadora');
    setTimeout(() => this.weightInput?.nativeElement.focus());
  }

  private save(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const state: SavedState = {
      budget: this.budget(),
      weight: this.weight(),
      auctionPrice: this.auctionPrice(),
      purchases: this.purchases(),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(state));
  }

  private restore(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return;
    }
    try {
      const saved = JSON.parse(raw) as SavedState;
      if ('budget' in saved) {
        this.budget.set(this.toNumber(saved.budget));
      }
      if ('weight' in saved) {
        this.weight.set(this.toNumber(saved.weight));
      }
      if ('auctionPrice' in saved) {
        this.auctionPrice.set(this.toNumber(saved.auctionPrice));
      }
      if (Array.isArray(saved.purchases)) {
        this.purchases.set(
          saved.purchases
            .map((purchase) => this.toPurchase(purchase))
            .filter((purchase): purchase is Purchase => purchase !== null)
        );
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  private toPurchase(value: unknown): Purchase | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const candidate = value as Partial<Purchase>;
    if (
      typeof candidate.weight !== 'number' ||
      !Number.isFinite(candidate.weight) ||
      typeof candidate.price !== 'number' ||
      !Number.isFinite(candidate.price)
    ) {
      return null;
    }
    return {
      id: typeof candidate.id === 'string' ? candidate.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
      weight: candidate.weight,
      price: candidate.price,
      total:
        typeof candidate.total === 'number' && Number.isFinite(candidate.total)
          ? candidate.total
          : candidate.weight * candidate.price,
    };
  }

  private toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  money(value: number | null): string {
    return value !== null && Number.isFinite(value)
      ? value.toLocaleString('es-CR', {
          style: 'currency',
          currency: 'CRC',
          maximumFractionDigits: 2,
        })
      : '—';
  }

  formatNumber(value: number | null): string {
    return value !== null && Number.isFinite(value)
      ? value.toLocaleString('es-CR', { maximumFractionDigits: 2 })
      : '—';
  }

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });
  }
}
