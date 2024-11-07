import { genericRetriableErrorDialogAttributes } from "@/base/components/utils/dialog";
import log from "@/base/log";
import { useUserDetailsSnapshot } from "@/new/photos/components/utils/use-snapshot";
import type {
    Bonus,
    Plan,
    PlanPeriod,
    PlansData,
    Subscription,
} from "@/new/photos/services/plan";
import {
    activateStripeSubscription,
    cancelStripeSubscription,
    getPlansData,
    isSubscriptionActive,
    isSubscriptionActiveFree,
    isSubscriptionActivePaid,
    isSubscriptionCancelled,
    isSubscriptionStripe,
    planUsage,
    redirectToCustomerPortal,
    redirectToPaymentsApp,
    userDetailsAddOnBonuses,
} from "@/new/photos/services/plan";
import { AppContext } from "@/new/photos/types/context";
import { bytesInGB, formattedStorageByteSize } from "@/new/photos/utils/units";
import { openURL } from "@/new/photos/utils/web";
import {
    FlexWrapper,
    FluidContainer,
    SpaceBetweenFlex,
} from "@ente/shared/components/Container";
import ArrowForward from "@mui/icons-material/ArrowForward";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Close from "@mui/icons-material/Close";
import Done from "@mui/icons-material/Done";
import {
    Button,
    ButtonProps,
    Dialog,
    IconButton,
    Link,
    Stack,
    styled,
    ToggleButton,
    ToggleButtonGroup,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { t } from "i18next";
import { useCallback, useContext, useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { getFamilyPortalRedirectURL } from "services/userService";
import { SetLoading } from "types/gallery";

interface PlanSelectorProps {
    modalView: boolean;
    closeModal: any;
    setLoading: SetLoading;
}

function PlanSelector(props: PlanSelectorProps) {
    const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));

    if (!props.modalView) {
        return <></>;
    }

    return (
        <Dialog
            {...{ fullScreen }}
            open={props.modalView}
            onClose={props.closeModal}
            PaperProps={{
                sx: (theme) => ({
                    width: { sm: "391px" },
                    p: 1,
                    [theme.breakpoints.down(360)]: { p: 0 },
                }),
            }}
        >
            <PlanSelectorCard
                closeModal={props.closeModal}
                setLoading={props.setLoading}
            />
        </Dialog>
    );
}

export default PlanSelector;

interface PlanSelectorCardProps {
    closeModal: any;
    setLoading: SetLoading;
}

const PlanSelectorCard: React.FC<PlanSelectorCardProps> = ({
    closeModal,
    setLoading,
}) => {
    const { showMiniDialog, setDialogMessage } = useContext(AppContext);

    const userDetails = useUserDetailsSnapshot();

    const [plansData, setPlansData] = useState<PlansData | undefined>();
    const [planPeriod, setPlanPeriod] = useState<PlanPeriod | undefined>(
        userDetails?.subscription?.period,
    );

    const usage = userDetails ? planUsage(userDetails) : 0;
    const subscription = userDetails?.subscription;
    const addOnBonuses = userDetails
        ? userDetailsAddOnBonuses(userDetails)
        : [];

    const togglePeriod = useCallback(
        () => setPlanPeriod((prev) => (prev == "month" ? "year" : "month")),
        [],
    );

    useEffect(() => {
        const main = async () => {
            try {
                setLoading(true);
                const plansData = await getPlansData();
                const { plans } = plansData;
                if (isSubscriptionActive(subscription)) {
                    const planNotListed =
                        plans.filter((plan) =>
                            isUserSubscribedPlan(plan, subscription),
                        ).length === 0;
                    if (
                        subscription &&
                        !isSubscriptionActiveFree(subscription) &&
                        planNotListed
                    ) {
                        plans.push({
                            id: subscription.productID,
                            storage: subscription.storage,
                            price: subscription.price,
                            period: subscription.period,
                            stripeID: subscription.productID,
                            iosID: subscription.productID,
                            androidID: subscription.productID,
                        });
                    }
                }
                setPlansData(plansData);
            } catch (e) {
                log.error("plan selector modal open failed", e);
                closeModal();
                showMiniDialog(genericRetriableErrorDialogAttributes());
            } finally {
                setLoading(false);
            }
        };
        main();
    }, []);

    async function onPlanSelect(plan: Plan) {
        switch (planSelectionOutcome(subscription)) {
            case "buyPlan":
                try {
                    setLoading(true);
                    await redirectToPaymentsApp(plan.stripeID, "buy");
                } catch (e) {
                    setLoading(false);
                    setDialogMessage({
                        title: t("error"),
                        content: t("SUBSCRIPTION_PURCHASE_FAILED"),
                        close: { variant: "critical" },
                    });
                }
                break;

            case "updateSubscriptionToPlan":
                setDialogMessage({
                    title: t("update_subscription_title"),
                    content: t("UPDATE_SUBSCRIPTION_MESSAGE"),
                    proceed: {
                        text: t("UPDATE_SUBSCRIPTION"),
                        variant: "accent",
                        action: async () => {
                            try {
                                setLoading(true);
                                await redirectToPaymentsApp(
                                    plan.stripeID,
                                    "update",
                                );
                            } catch (err) {
                                setDialogMessage({
                                    title: t("error"),
                                    content: t("SUBSCRIPTION_UPDATE_FAILED"),
                                    close: { variant: "critical" },
                                });
                            } finally {
                                setLoading(false);
                                closeModal();
                            }
                        },
                    },
                    close: { text: t("cancel") },
                });
                break;

            case "cancelOnMobile":
                setDialogMessage({
                    title: t("CANCEL_SUBSCRIPTION_ON_MOBILE"),
                    content: t("CANCEL_SUBSCRIPTION_ON_MOBILE_MESSAGE"),
                    close: { variant: "secondary" },
                });
                break;

            case "contactSupport":
                setDialogMessage({
                    title: t("MANAGE_PLAN"),
                    content: (
                        <Trans
                            i18nKey={"MAIL_TO_MANAGE_SUBSCRIPTION"}
                            components={{
                                a: <Link href="mailto:support@ente.io" />,
                            }}
                            values={{ emailID: "support@ente.io" }}
                        />
                    ),
                    close: { variant: "secondary" },
                });
                break;
        }
    }

    const commonCardData = {
        subscription,
        addOnBonuses,
        closeModal,
        planPeriod,
        togglePeriod,
        setLoading,
    };

    const plansList = (
        <Plans
            plansData={plansData}
            planPeriod={planPeriod}
            onPlanSelect={onPlanSelect}
            subscription={subscription}
            hasAddOnBonus={addOnBonuses.length > 0}
            closeModal={closeModal}
        />
    );

    return (
        <Stack spacing={3} p={1.5}>
            {isSubscriptionActivePaid(subscription) ? (
                <PaidSubscriptionPlanSelectorCard
                    {...commonCardData}
                    usage={usage}
                >
                    {plansList}
                </PaidSubscriptionPlanSelectorCard>
            ) : (
                <FreeSubscriptionPlanSelectorCard {...commonCardData}>
                    {plansList}
                </FreeSubscriptionPlanSelectorCard>
            )}
        </Stack>
    );
};

/**
 * Return the outcome that should happen when the user selects a paid plan on
 * the plan selection screen.
 *
 * @param subscription Their current subscription details.
 */
const planSelectionOutcome = (subscription: Subscription | undefined) => {
    // This shouldn't happen, but we need this case to handle missing types.
    if (!subscription) return "buyPlan";

    // The user is a on a free plan and can buy the plan they selected.
    if (subscription.productID == "free") return "buyPlan";

    // Their existing subscription has expired. They can buy a new plan.
    if (subscription.expiryTime < Date.now() * 1000) return "buyPlan";

    // -- The user already has an active subscription to a paid plan.

    // Using Stripe.
    if (subscription.paymentProvider == "stripe") {
        // Update their existing subscription to the new plan.
        return "updateSubscriptionToPlan";
    }

    // Using one of the mobile app stores.
    if (
        subscription.paymentProvider == "appstore" ||
        subscription.paymentProvider == "playstore"
    ) {
        // They need to cancel first on the mobile app stores.
        return "cancelOnMobile";
    }

    // Some other bespoke case. They should contact support.
    return "contactSupport";
};

function FreeSubscriptionPlanSelectorCard({
    children,
    subscription,
    addOnBonuses,
    closeModal,
    setLoading,
    planPeriod,
    togglePeriod,
}) {
    return (
        <>
            <Typography variant="h3" fontWeight={"bold"}>
                {t("CHOOSE_PLAN")}
            </Typography>

            <Box>
                <Stack spacing={3}>
                    <Box>
                        <PeriodToggler
                            planPeriod={planPeriod}
                            togglePeriod={togglePeriod}
                        />
                        <Typography variant="small" mt={0.5} color="text.muted">
                            {t("TWO_MONTHS_FREE")}
                        </Typography>
                    </Box>
                    {children}
                    {addOnBonuses.length > 0 && (
                        <>
                            <AddOnBonusRows
                                addOnBonuses={addOnBonuses}
                                closeModal={closeModal}
                            />
                            <ManageSubscription
                                subscription={subscription}
                                hasAddOnBonus={true}
                                closeModal={closeModal}
                                setLoading={setLoading}
                            />
                        </>
                    )}
                </Stack>
            </Box>
        </>
    );
}

function PaidSubscriptionPlanSelectorCard({
    children,
    subscription,
    addOnBonuses,
    closeModal,
    usage,
    planPeriod,
    togglePeriod,
    setLoading,
}) {
    return (
        <>
            <Box pl={1.5} py={0.5}>
                <SpaceBetweenFlex>
                    <Box>
                        <Typography variant="h3" fontWeight={"bold"}>
                            {t("SUBSCRIPTION")}
                        </Typography>
                        <Typography variant="small" color={"text.muted"}>
                            {bytesInGB(subscription.storage, 2)}{" "}
                            {t("storage_unit.gb")}
                        </Typography>
                    </Box>
                    <IconButton onClick={closeModal} color="secondary">
                        <Close />
                    </IconButton>
                </SpaceBetweenFlex>
            </Box>

            <Box px={1.5}>
                <Typography color={"text.muted"} fontWeight={"bold"}>
                    <Trans
                        i18nKey="CURRENT_USAGE"
                        values={{
                            usage: `${bytesInGB(usage, 2)} ${t("storage_unit.gb")}`,
                        }}
                    />
                </Typography>
            </Box>

            <Box>
                <Stack
                    spacing={3}
                    border={(theme) => `1px solid ${theme.palette.divider}`}
                    p={1.5}
                    borderRadius={(theme) => `${theme.shape.borderRadius}px`}
                >
                    <Box>
                        <PeriodToggler
                            planPeriod={planPeriod}
                            togglePeriod={togglePeriod}
                        />
                        <Typography variant="small" mt={0.5} color="text.muted">
                            {t("TWO_MONTHS_FREE")}
                        </Typography>
                    </Box>
                    {children}
                </Stack>

                <Box py={1} px={1.5}>
                    <Typography color={"text.muted"}>
                        {!isSubscriptionCancelled(subscription)
                            ? t("subscription_status_renewal_active", {
                                  date: subscription.expiryTime,
                              })
                            : t("subscription_status_renewal_cancelled", {
                                  date: subscription.expiryTime,
                              })}
                    </Typography>
                    {addOnBonuses.length > 0 && (
                        <AddOnBonusRows
                            addOnBonuses={addOnBonuses}
                            closeModal={closeModal}
                        />
                    )}
                </Box>
            </Box>

            <ManageSubscription
                subscription={subscription}
                hasAddOnBonus={addOnBonuses.length > 0}
                closeModal={closeModal}
                setLoading={setLoading}
            />
        </>
    );
}

function PeriodToggler({ planPeriod, togglePeriod }) {
    const handleChange = (_, newPlanPeriod: PlanPeriod) => {
        if (newPlanPeriod !== planPeriod) togglePeriod();
    };

    return (
        <ToggleButtonGroup
            value={planPeriod}
            exclusive
            onChange={handleChange}
            color="primary"
        >
            <CustomToggleButton value={"month"}>
                {t("MONTHLY")}
            </CustomToggleButton>
            <CustomToggleButton value={"year"}>
                {t("YEARLY")}
            </CustomToggleButton>
        </ToggleButtonGroup>
    );
}

const CustomToggleButton = styled(ToggleButton)(({ theme }) => ({
    textTransform: "none",
    padding: "12px 16px",
    borderRadius: "4px",
    backgroundColor: theme.colors.fill.faint,
    border: `1px solid transparent`,
    color: theme.colors.text.faint,
    "&.Mui-selected": {
        backgroundColor: theme.colors.accent.A500,
        color: theme.colors.text.base,
    },
    "&.Mui-selected:hover": {
        backgroundColor: theme.colors.accent.A500,
        color: theme.colors.text.base,
    },
    width: "97.433px",
}));

interface PlansProps {
    plansData: PlansData | undefined;
    planPeriod: PlanPeriod;
    subscription: Subscription;
    hasAddOnBonus: boolean;
    onPlanSelect: (plan: Plan) => void;
    closeModal: () => void;
}

const Plans = ({
    plansData,
    planPeriod,
    subscription,
    hasAddOnBonus,
    onPlanSelect,
    closeModal,
}: PlansProps) => {
    const { freePlan, plans } = plansData ?? {};
    return (
        <Stack spacing={2}>
            {plans
                ?.filter((plan) => plan.period === planPeriod)
                ?.map((plan) => (
                    <PlanRow
                        disabled={isUserSubscribedPlan(plan, subscription)}
                        popular={isPopularPlan(plan)}
                        key={plan.stripeID}
                        plan={plan}
                        subscription={subscription}
                        onPlanSelect={onPlanSelect}
                    />
                ))}
            {!isSubscriptionActivePaid(subscription) &&
                !hasAddOnBonus &&
                freePlan && (
                    <FreePlanRow
                        storage={freePlan.storage}
                        closeModal={closeModal}
                    />
                )}
        </Stack>
    );
};

function isUserSubscribedPlan(plan: Plan, subscription: Subscription) {
    return (
        isSubscriptionActive(subscription) &&
        (plan.stripeID === subscription.productID ||
            plan.iosID === subscription.productID ||
            plan.androidID === subscription.productID)
    );
}

const isPopularPlan = (plan: Plan) =>
    plan.storage === 100 * 1024 * 1024 * 1024; /* 100 GB */

interface PlanRowProps {
    plan: Plan;
    subscription: Subscription;
    onPlanSelect: (plan: Plan) => void;
    disabled: boolean;
    popular: boolean;
}

function PlanRow({
    plan,
    subscription,
    onPlanSelect,
    disabled,
    popular,
}: PlanRowProps) {
    const handleClick = () => {
        !isUserSubscribedPlan(plan, subscription) && onPlanSelect(plan);
    };

    const PlanButton = disabled ? DisabledPlanButton : ActivePlanButton;

    return (
        <PlanRowContainer>
            <TopAlignedFluidContainer>
                <Typography variant="h1" fontWeight={"bold"}>
                    {bytesInGB(plan.storage)}
                </Typography>
                <FlexWrapper flexWrap={"wrap"} gap={1}>
                    <Typography variant="h3" color="text.muted">
                        {t("storage_unit.gb")}
                    </Typography>
                    {popular && !isSubscriptionActivePaid(subscription) && (
                        <Badge>{t("POPULAR")}</Badge>
                    )}
                </FlexWrapper>
            </TopAlignedFluidContainer>
            <Box width="136px">
                <PlanButton
                    sx={{
                        justifyContent: "flex-end",
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                    }}
                    size="large"
                    onClick={handleClick}
                >
                    <Box textAlign={"right"}>
                        <Typography fontWeight={"bold"} variant="large">
                            {plan.price}{" "}
                        </Typography>{" "}
                        <Typography color="text.muted" variant="small">
                            {`/ ${
                                plan.period === "month"
                                    ? t("MONTH_SHORT")
                                    : t("YEAR")
                            }`}
                        </Typography>
                    </Box>
                </PlanButton>
            </Box>
        </PlanRowContainer>
    );
}

const PlanRowContainer = styled(FlexWrapper)(() => ({
    background:
        "linear-gradient(268.22deg, rgba(256, 256, 256, 0.08) -3.72%, rgba(256, 256, 256, 0) 85.73%)",
}));

const TopAlignedFluidContainer = styled(FluidContainer)`
    align-items: flex-start;
`;

const DisabledPlanButton = styled((props: ButtonProps) => (
    <Button disabled endIcon={<Done />} {...props} />
))(({ theme }) => ({
    "&.Mui-disabled": {
        backgroundColor: "transparent",
        color: theme.colors.text.base,
    },
}));

const ActivePlanButton = styled((props: ButtonProps) => (
    <Button color="accent" {...props} endIcon={<ArrowForward />} />
))(() => ({
    ".MuiButton-endIcon": {
        transition: "transform .2s ease-in-out",
    },
    "&:hover .MuiButton-endIcon": {
        transform: "translateX(4px)",
    },
}));

const Badge = styled(Box)(({ theme }) => ({
    borderRadius: theme.shape.borderRadius,
    padding: "2px 4px",
    backgroundColor: theme.colors.black.muted,
    backdropFilter: `blur(${theme.colors.blur.muted})`,
    color: theme.colors.white.base,
    textTransform: "uppercase",
    ...theme.typography.mini,
}));

interface FreePlanRowProps {
    storage: number;
    closeModal: () => void;
}

const FreePlanRow: React.FC<FreePlanRowProps> = ({ closeModal, storage }) => {
    return (
        <FreePlanRow_ onClick={closeModal}>
            <Box>
                <Typography>{t("free_plan_option")}</Typography>
                <Typography variant="small" color="text.muted">
                    {t("free_plan_description", {
                        storage: formattedStorageByteSize(storage),
                    })}
                </Typography>
            </Box>
            <IconButton className={"endIcon"}>
                <ArrowForward />
            </IconButton>
        </FreePlanRow_>
    );
};

const FreePlanRow_ = styled(SpaceBetweenFlex)(({ theme }) => ({
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 1),
    cursor: "pointer",
    "&:hover .endIcon": {
        backgroundColor: "rgba(255,255,255,0.08)",
    },
}));

interface AddOnBonusRowsProps {
    addOnBonuses: Bonus[];
    closeModal: () => void;
}

const AddOnBonusRows: React.FC<AddOnBonusRowsProps> = ({
    addOnBonuses,
    closeModal,
}) => (
    <>
        {addOnBonuses.map((bonus, i) => (
            <AddOnRowContainer key={i} onClick={closeModal}>
                <Typography color="text.muted">
                    <Trans
                        i18nKey={"add_on_valid_till"}
                        values={{
                            storage: formattedStorageByteSize(bonus.storage),
                            date: bonus.validTill,
                        }}
                    />
                </Typography>
            </AddOnRowContainer>
        ))}
    </>
);

const AddOnRowContainer = styled(SpaceBetweenFlex)(({ theme }) => ({
    // gap: theme.spacing(1.5),
    padding: theme.spacing(1, 0),
    cursor: "pointer",
    "&:hover .endIcon": {
        backgroundColor: "rgba(255,255,255,0.08)",
    },
}));

interface ManageSubscriptionProps {
    subscription: Subscription;
    hasAddOnBonus: boolean;
    closeModal: () => void;
    setLoading: SetLoading;
}

function ManageSubscription({
    subscription,
    hasAddOnBonus,
    closeModal,
    setLoading,
}: ManageSubscriptionProps) {
    const { setDialogMessage } = useContext(AppContext);

    const openFamilyPortal = async () => {
        setLoading(true);
        try {
            openURL(await getFamilyPortalRedirectURL());
        } catch (e) {
            log.error("Could not redirect to family portal", e);
            setDialogMessage({
                title: t("error"),
                content: t("generic_error_retry"),
                close: { variant: "critical" },
            });
        }
        setLoading(false);
    };

    return (
        <Stack spacing={1}>
            {isSubscriptionStripe(subscription) && (
                <StripeSubscriptionOptions
                    subscription={subscription}
                    hasAddOnBonus={hasAddOnBonus}
                    closeModal={closeModal}
                    setLoading={setLoading}
                />
            )}
            <ManageSubscriptionButton
                color="secondary"
                onClick={openFamilyPortal}
            >
                {t("MANAGE_FAMILY_PORTAL")}
            </ManageSubscriptionButton>
        </Stack>
    );
}

function StripeSubscriptionOptions({
    subscription,
    hasAddOnBonus,
    setLoading,
    closeModal,
}: ManageSubscriptionProps) {
    const appContext = useContext(AppContext);
    const { setDialogMessage } = appContext;

    const confirmReactivation = () =>
        appContext.setDialogMessage({
            title: t("REACTIVATE_SUBSCRIPTION"),
            content: t("REACTIVATE_SUBSCRIPTION_MESSAGE", {
                date: subscription.expiryTime,
            }),
            proceed: {
                text: t("REACTIVATE_SUBSCRIPTION"),
                action: reactivate,
                variant: "accent",
            },
            close: {
                text: t("cancel"),
            },
        });

    const reactivate = async () => {
        try {
            setLoading(true);
            await activateStripeSubscription();
            setDialogMessage({
                title: t("success"),
                content: t("SUBSCRIPTION_ACTIVATE_SUCCESS"),
                close: { variant: "accent" },
            });
        } catch (e) {
            console.log(e);
            setDialogMessage({
                title: t("error"),
                content: t("SUBSCRIPTION_ACTIVATE_FAILED"),
                close: { variant: "critical" },
            });
        } finally {
            closeModal();
            setLoading(false);
        }
    };

    const confirmCancel = () =>
        appContext.setDialogMessage({
            title: t("CANCEL_SUBSCRIPTION"),
            content: hasAddOnBonus ? (
                <Trans i18nKey={"CANCEL_SUBSCRIPTION_WITH_ADDON_MESSAGE"} />
            ) : (
                <Trans i18nKey={"CANCEL_SUBSCRIPTION_MESSAGE"} />
            ),
            proceed: {
                text: t("CANCEL_SUBSCRIPTION"),
                action: cancel,
                variant: "critical",
            },
            close: {
                text: t("NEVERMIND"),
            },
        });

    const cancel = async () => {
        try {
            setLoading(true);
            await cancelStripeSubscription();
            setDialogMessage({
                title: t("success"),
                content: t("SUBSCRIPTION_CANCEL_SUCCESS"),
                close: { variant: "accent" },
            });
        } catch (e) {
            console.log(e);
            setDialogMessage({
                title: t("error"),
                content: t("SUBSCRIPTION_CANCEL_FAILED"),
                close: { variant: "critical" },
            });
        } finally {
            closeModal();
            setLoading(false);
        }
    };

    const openManagementPortal = async () => {
        try {
            setLoading(true);
            await redirectToCustomerPortal();
        } catch (error) {
            setLoading(false);
            setDialogMessage({
                title: t("error"),
                content: t("generic_error_retry"),
                close: { variant: "critical" },
            });
        }
    };

    return (
        <>
            {isSubscriptionCancelled(subscription) ? (
                <ManageSubscriptionButton
                    color="secondary"
                    onClick={confirmReactivation}
                >
                    {t("REACTIVATE_SUBSCRIPTION")}
                </ManageSubscriptionButton>
            ) : (
                <ManageSubscriptionButton
                    color="secondary"
                    onClick={confirmCancel}
                >
                    {t("CANCEL_SUBSCRIPTION")}
                </ManageSubscriptionButton>
            )}
            <ManageSubscriptionButton
                color="secondary"
                onClick={openManagementPortal}
            >
                {t("MANAGEMENT_PORTAL")}
            </ManageSubscriptionButton>
        </>
    );
}

const ManageSubscriptionButton = ({ children, ...props }: ButtonProps) => (
    <Button size="large" endIcon={<ChevronRight />} {...props}>
        <FluidContainer>{children}</FluidContainer>
    </Button>
);
