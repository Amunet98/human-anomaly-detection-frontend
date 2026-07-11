import { createStyles, Container, Group, ActionIcon, rem } from "@mantine/core";
import {
  IconBrandTwitter,
  IconBrandInstagram,
  IconBrandFacebook,
} from "@tabler/icons-react";


const useStyles = createStyles((theme) => ({
  footer: {
    display: "flex",
    width: "100%",
    marginTop: rem(120),
    borderTop: `${rem(1)} solid ${theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2]
      }`,
  },

  inner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,

    [theme.fn.smallerThan("xs")]: {
      flexDirection: "column",
    },
  },

  links: {
    [theme.fn.smallerThan("xs")]: {
      marginTop: theme.spacing.md,
    },
  },
}));

export function FooterLinks() {
  return (
    <div className="flex justify-center self-center mt-8 mb-4 px-4 w-full">
      <div className="max-w-full">
        <span className="flex flex-row flex-wrap items-center justify-center gap-1 text-center rounded-lg px-4 py-2 sm:px-8 bg-black">
          <span className="self-center text-sm sm:text-lg">
            Made In <em>"AIT"</em> By "Bimesh Poudel and Prasanna singh k.c." with
          </span>
          <span className="text-2xl sm:text-3xl">
            💗
          </span>
        </span>
      </div>
    </div>
  )
}
