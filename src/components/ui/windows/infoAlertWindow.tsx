import {AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,AlertDialogTrigger} from "@/components/ui/alert-dialog"
import { Button } from "../button";
import { useTranslation } from "react-i18next";
import { HelpOutlineIcon } from "../icons/help-icon";


export default function InfoAlertWindow() {

    const { t } = useTranslation('common');

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 overflow-hidden rounded-full p-0 text-white hover:shadow-white hover:text-white">
                   <HelpOutlineIcon className="size-full fill-current" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('welcome.title')}</AlertDialogTitle>
                    <AlertDialogDescription className="whitespace-pre-line">
                        {t('welcome.description')}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction>
                        {t('general.okay')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

}
