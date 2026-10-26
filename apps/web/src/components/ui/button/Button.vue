<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[3px] border border-transparent text-[12px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-pine text-on-pine hover:bg-pine/90",
        destructive: "border-orange bg-transparent text-orange hover:bg-orange/5",
        outline: "border-line bg-transparent text-muted-foreground hover:border-muted hover:text-ink",
        secondary: "bg-hover text-ink hover:bg-hover/80",
        ghost: "text-muted-foreground hover:bg-hover hover:text-ink",
        link: "text-orange underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-[26px] px-2.5 text-[11.5px]",
        lg: "h-10 px-5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  variant: "default",
  size: "default",
});
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>
