import * as React from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { cn } from "$lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "$lib/components/ui/input-group"
import { t, useLanguage } from "$lib/i18n/i18n"

type PasswordInputContextValue = {
  visible: boolean
  setVisible: (visible: boolean) => void
}

const PasswordInputContext = React.createContext<PasswordInputContextValue | null>(null)

function usePasswordInput() {
  const context = React.useContext(PasswordInputContext)
  if (!context) throw new Error("PasswordInput parts must be used inside <PasswordInput>")
  return context
}

function PasswordInput({
  className,
  visible: visibleProp,
  defaultVisible = false,
  onVisibleChange,
  ...props
}: React.ComponentProps<"div"> & {
  visible?: boolean
  defaultVisible?: boolean
  onVisibleChange?: (visible: boolean) => void
}) {
  const [internal, setInternal] = React.useState(defaultVisible)
  const visible = visibleProp ?? internal
  const setVisible = React.useCallback(
    (next: boolean) => {
      if (visibleProp === undefined) setInternal(next)
      onVisibleChange?.(next)
    },
    [visibleProp, onVisibleChange]
  )
  const value = React.useMemo(() => ({ visible, setVisible }), [visible, setVisible])

  return (
    <PasswordInputContext.Provider value={value}>
      <div
        data-slot="password-input"
        data-visible={visible || undefined}
        className={cn("w-full", className)}
        {...props}
      />
    </PasswordInputContext.Provider>
  )
}

function PasswordInputGroup({ className, ...props }: React.ComponentProps<typeof InputGroup>) {
  return <InputGroup data-slot="password-input-group" className={className} {...props} />
}

function PasswordInputInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupInput>, "type">) {
  const { visible } = usePasswordInput()
  return (
    <InputGroupInput
      data-slot="password-input-input"
      type={visible ? "text" : "password"}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className={cn("font-mono", className)}
      {...props}
    />
  )
}

function PasswordInputTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof InputGroupButton>) {
  useLanguage()
  const { visible, setVisible } = usePasswordInput()
  return (
    <InputGroupAddon align="inline-end">
      <InputGroupButton
        data-slot="password-input-trigger"
        size="icon-xs"
        aria-label={visible ? t("settings.hideKey") : t("settings.showKey")}
        aria-pressed={visible}
        className={cn("text-muted-foreground aria-pressed:text-foreground", className)}
        onClick={(e) => {
          onClick?.(e)
          setVisible(!visible)
        }}
        {...props}
      >
        {visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </InputGroupButton>
    </InputGroupAddon>
  )
}

export { PasswordInput, PasswordInputGroup, PasswordInputInput, PasswordInputTrigger }
