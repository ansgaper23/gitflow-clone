// backend/src/services/uiComponentsSeed.js
// CATÁLOGO DE COMPONENTES SHADCN/UI INDUSTRIALES PREINSTALADOS (FLOWPRO SEED)
// Primitivas en React + Tailwind CSS con tokens semánticos HSL y cero dependencias pesadas.

export const UI_COMPONENTS_SEED = {
  'src/components/ui/button.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = {
  variant: {
    default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
  },
  size: {
    default: "h-9 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    lg: "h-10 rounded-md px-8",
    icon: "h-9 w-9",
  },
}

const Button = React.forwardRef(({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
  const Comp = asChild ? "span" : "button"
  const variantClass = buttonVariants.variant[variant] || buttonVariants.variant.default
  const sizeClass = buttonVariants.size[size] || buttonVariants.size.default
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        variantClass,
        sizeClass,
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
`,

  'src/components/ui/card.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
`,

  'src/components/ui/badge.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const badgeVariants = {
  default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
  outline: "text-foreground",
}

function Badge({ className, variant = "default", ...props }) {
  const variantClass = badgeVariants[variant] || badgeVariants.default
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variantClass,
        className
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
`,

  'src/components/ui/input.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
`,

  'src/components/ui/textarea.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
`,

  'src/components/ui/label.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Label = React.forwardRef(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className
    )}
    {...props}
  />
))
Label.displayName = "Label"

export { Label }
`,

  'src/components/ui/select.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Select = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <select
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
})
Select.displayName = "Select"

export { Select }
`,

  'src/components/ui/dialog.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

const DialogContext = React.createContext({
  open: false,
  onOpenChange: () => {},
})

function Dialog({ children, open: controlledOpen, onOpenChange: setControlledOpen, defaultOpen = false }) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const onOpenChange = isControlled ? setControlledOpen : setUncontrolledOpen

  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({ children, asChild, ...props }) {
  const { onOpenChange } = React.useContext(DialogContext)
  return (
    <span onClick={() => onOpenChange(true)} className="cursor-pointer inline-block" {...props}>
      {children}
    </span>
  )
}

function DialogContent({ className, children, ...props }) {
  const { open, onOpenChange } = React.useContext(DialogContext)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          "relative z-50 grid w-full max-w-lg gap-4 rounded-lg border border-border bg-background p-6 shadow-lg duration-200",
          className
        )}
        {...props}
      >
        {children}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </button>
      </div>
    </div>
  )
}

function DialogHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
}

function DialogFooter({ className, ...props }) {
  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
}

function DialogTitle({ className, ...props }) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
}

function DialogDescription({ className, ...props }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
`,

  'src/components/ui/sheet.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

const SheetContext = React.createContext({
  open: false,
  onOpenChange: () => {},
})

function Sheet({ children, open: controlledOpen, onOpenChange: setControlledOpen, defaultOpen = false }) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const onOpenChange = isControlled ? setControlledOpen : setUncontrolledOpen

  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({ children, ...props }) {
  const { onOpenChange } = React.useContext(SheetContext)
  return (
    <span onClick={() => onOpenChange(true)} className="cursor-pointer inline-block" {...props}>
      {children}
    </span>
  )
}

function SheetContent({ className, children, side = "right", ...props }) {
  const { open, onOpenChange } = React.useContext(SheetContext)
  if (!open) return null

  const sideClasses = {
    top: "inset-x-0 top-0 border-b",
    bottom: "inset-x-0 bottom-0 border-t",
    left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
    right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out duration-300 flex flex-col",
          sideClasses[side] || sideClasses.right,
          className
        )}
        {...props}
      >
        {children}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </button>
      </div>
    </div>
  )
}

function SheetHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
}

function SheetTitle({ className, ...props }) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)} {...props} />
}

function SheetDescription({ className, ...props }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription }
`,

  'src/components/ui/tabs.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const TabsContext = React.createContext({
  value: "",
  onValueChange: () => {},
})

function Tabs({ defaultValue, value: controlledValue, onValueChange: setControlledValue, className, children, ...props }) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue || "")
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue
  const onValueChange = isControlled ? setControlledValue : setUncontrolledValue

  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

function TabsList({ className, ...props }) {
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ value, className, children, ...props }) {
  const context = React.useContext(TabsContext)
  const isSelected = context.value === value
  return (
    <button
      type="button"
      onClick={() => context.onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isSelected && "bg-background text-foreground shadow",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function TabsContent({ value, className, children, ...props }) {
  const context = React.useContext(TabsContext)
  if (context.value !== value) return null
  return (
    <div
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
`,

  'src/components/ui/table.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
`,

  'src/components/ui/accordion.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

const AccordionContext = React.createContext({
  openItems: new Set(),
  toggleItem: () => {},
})

function Accordion({ type = "single", collapsible = true, defaultValue, className, children, ...props }) {
  const [openItems, setOpenItems] = React.useState(() => {
    if (!defaultValue) return new Set()
    return new Set(Array.isArray(defaultValue) ? defaultValue : [defaultValue])
  })

  const toggleItem = (val) => {
    setOpenItems((prev) => {
      const next = new Set(type === "multiple" ? prev : [])
      if (prev.has(val)) {
        if (collapsible || (type === "multiple" && prev.size > 1)) {
          next.delete(val)
        }
      } else {
        next.add(val)
      }
      return next
    })
  }

  return (
    <AccordionContext.Provider value={{ openItems, toggleItem }}>
      <div className={cn("divide-y divide-border", className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  )
}

function AccordionItem({ value, className, children, ...props }) {
  return (
    <div className={cn("border-b border-border", className)} data-value={value} {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, { itemValue: value })
        }
        return child
      })}
    </div>
  )
}

function AccordionTrigger({ itemValue, className, children, ...props }) {
  const { openItems, toggleItem } = React.useContext(AccordionContext)
  const isOpen = openItems.has(itemValue)

  return (
    <button
      type="button"
      onClick={() => toggleItem(itemValue)}
      className={cn(
        "flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline text-left w-full",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
      />
    </button>
  )
}

function AccordionContent({ itemValue, className, children, ...props }) {
  const { openItems } = React.useContext(AccordionContext)
  const isOpen = openItems.has(itemValue)
  if (!isOpen) return null

  return (
    <div className={cn("overflow-hidden text-sm pb-4 pt-0 text-muted-foreground", className)} {...props}>
      {children}
    </div>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
`,

  'src/components/ui/separator.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Separator = React.forwardRef(
  ({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = "Separator"

export { Separator }
`,

  'src/components/ui/skeleton.jsx': `import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
`,

  'src/components/ui/switch.jsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, checked: controlledChecked, defaultChecked = false, onCheckedChange, ...props }, ref) => {
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(defaultChecked)
  const isControlled = controlledChecked !== undefined
  const checked = isControlled ? controlledChecked : uncontrolledChecked

  const handleClick = () => {
    const next = !checked
    if (!isControlled) setUncontrolledChecked(next)
    if (onCheckedChange) onCheckedChange(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      ref={ref}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
})
Switch.displayName = "Switch"

export { Switch }
`
}
